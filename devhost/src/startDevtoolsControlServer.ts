import { fileURLToPath } from "node:url";

import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { createConfiguredDevtoolsScript } from "./createConfiguredDevtoolsScript";
import type { IAnnotationMarkerPayload, IAnnotationSubmitDetail } from "./devtools/features/annotationComposer/types";
import type {
  PiTerminalClientMessage,
  PiTerminalServerMessage,
  IStartPiSessionRequest,
} from "./devtools/features/piTerminal/types";
import {
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
  HEALTH_WEBSOCKET_PATH,
  INJECTED_SCRIPT_PATH,
  LOGS_WEBSOCKET_PATH,
  maximumRetainedLogEntries,
  PI_SESSION_ID_QUERY_PARAMETER_NAME,
  PI_SESSION_START_PATH,
  PI_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "./devtools/shared/constants";
import type {
  HealthResponse,
  ServiceLogEntry,
  ServiceLogSnapshotMessage,
  ServiceLogStream,
  ServiceLogUpdateMessage,
} from "./devtools/shared/types";
import type { ILaunchedPiTerminalSession } from "./launchPiTerminalSession";
import type { DevtoolsMinimapPosition, DevtoolsPosition } from "./stackTypes";

const healthTopicName: string = "devhost-health";
const logsTopicName: string = "devhost-logs";
const piSessionTopicName: string = "devhost-pi-session";
const healthPollIntervalInMilliseconds: number = 1_000;
const idlePiSessionTimeoutInMilliseconds: number = 10_000;
const maximumRetainedTerminalOutputCharacters: number = 128_000;
const xtermStylesheetFilePath: string = fileURLToPath(import.meta.resolve("@xterm/xterm/css/xterm.css"));

type WebSocketTopicName = typeof healthTopicName | typeof logsTopicName | typeof piSessionTopicName;

type DevtoolsWebSocketData = {
  sessionId?: string;
  topicName: WebSocketTopicName;
};

interface IDevtoolsControlServer {
  port: number;
  publishHealthResponse: () => Promise<void>;
  publishLogEntry: (serviceName: string, stream: ServiceLogStream, line: string) => void;
  stop: () => Promise<void>;
}

interface IStartDevtoolsControlServerOptions {
  devtoolsMinimapPosition: DevtoolsMinimapPosition;
  devtoolsPosition: DevtoolsPosition;
  getHealthResponse: () => Promise<HealthResponse>;
  stackName: string;
  startPiTerminalSession?: (
    detail: IAnnotationSubmitDetail,
    onData: (data: Uint8Array) => void,
  ) => ILaunchedPiTerminalSession;
}

interface IPiSessionExitStatus {
  exitCode: number | null;
  signalCode: string | null;
}

interface IPiTerminalSessionState {
  close: () => void;
  decoder: TextDecoder;
  exited: IPiSessionExitStatus | null;
  idleTimeoutId: ReturnType<typeof setTimeout> | null;
  outputBuffer: string;
  resize: (cols: number, rows: number) => void;
  sockets: Set<Bun.ServerWebSocket<DevtoolsWebSocketData>>;
  write: (data: string) => void;
}

export async function startDevtoolsControlServer(
  options: IStartDevtoolsControlServerOptions,
): Promise<IDevtoolsControlServer> {
  const controlToken: string = crypto.randomUUID();
  const devtoolsScript: string = createConfiguredDevtoolsScript(
    await buildDevtoolsScript(),
    options.devtoolsPosition,
    options.devtoolsMinimapPosition,
    options.stackName,
    controlToken,
  );
  const retainedLogEntries: ServiceLogEntry[] = [];
  const piSessions: Map<string, IPiTerminalSessionState> = new Map<string, IPiTerminalSessionState>();
  const xtermStylesheetText: string = await Bun.file(xtermStylesheetFilePath).text();
  let isStopped: boolean = false;
  let lastPublishedMessage: string | null = null;
  let nextLogEntryId: number = 1;

  const server = Bun.serve<DevtoolsWebSocketData>({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request: Request, bunServer: Bun.Server<DevtoolsWebSocketData>): Promise<Response | undefined> {
      const requestUrl: URL = new URL(request.url);

      if (requestUrl.pathname === INJECTED_SCRIPT_PATH) {
        return new Response(devtoolsScript, {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/javascript; charset=utf-8",
          },
        });
      }

      if (requestUrl.pathname === XTERM_STYLESHEET_PATH) {
        return new Response(xtermStylesheetText, {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/css; charset=utf-8",
          },
        });
      }

      if (requestUrl.pathname === PI_SESSION_START_PATH && request.method.toUpperCase() === "POST") {
        if (!isAuthorizedControlRequest(request, controlToken)) {
          return new Response("Forbidden", { status: 403 });
        }

        const requestBody: unknown = await readRequestJson(request);

        if (!isStartPiSessionRequest(requestBody)) {
          return new Response("Invalid annotation payload.", { status: 400 });
        }

        try {
          const sessionId: string = createPiSession(requestBody.annotation);

          return Response.json({
            sessionId,
          });
        } catch (error) {
          const message: string = error instanceof Error ? error.message : String(error);

          return new Response(message, { status: 500 });
        }
      }

      if (requestUrl.pathname === HEALTH_WEBSOCKET_PATH) {
        const didUpgrade: boolean = bunServer.upgrade(request, {
          data: {
            topicName: healthTopicName,
          },
        });

        if (didUpgrade) {
          return;
        }

        return new Response("Upgrade failed", { status: 400 });
      }

      if (requestUrl.pathname === LOGS_WEBSOCKET_PATH) {
        const didUpgrade: boolean = bunServer.upgrade(request, {
          data: {
            topicName: logsTopicName,
          },
        });

        if (didUpgrade) {
          return;
        }

        return new Response("Upgrade failed", { status: 400 });
      }

      if (requestUrl.pathname === PI_SESSION_WEBSOCKET_PATH) {
        const sessionId: string | null = requestUrl.searchParams.get(PI_SESSION_ID_QUERY_PARAMETER_NAME);
        const requestControlToken: string | null = requestUrl.searchParams.get(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME);

        if (requestControlToken !== controlToken) {
          return new Response("Forbidden", { status: 403 });
        }

        if (sessionId === null || sessionId.length === 0) {
          return new Response("Missing sessionId query parameter.", { status: 400 });
        }

        if (!piSessions.has(sessionId)) {
          return new Response("Pi session was not found.", { status: 404 });
        }

        const didUpgrade: boolean = bunServer.upgrade(request, {
          data: {
            sessionId,
            topicName: piSessionTopicName,
          },
        });

        if (didUpgrade) {
          return;
        }

        return new Response("Upgrade failed", { status: 400 });
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      message(websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>, message: string | ArrayBuffer | Uint8Array): void {
        if (websocket.data.topicName !== piSessionTopicName) {
          return;
        }

        if (typeof message !== "string") {
          websocket.send(JSON.stringify(createPiTerminalErrorMessage("Pi terminal messages must be text frames.")));
          return;
        }

        const clientMessage: PiTerminalClientMessage | null = parsePiTerminalClientMessage(message);

        if (clientMessage === null) {
          websocket.send(JSON.stringify(createPiTerminalErrorMessage("Invalid Pi terminal message.")));
          return;
        }

        const session: IPiTerminalSessionState | undefined = readPiSession(websocket.data.sessionId, piSessions);

        if (session === undefined) {
          websocket.send(JSON.stringify(createPiTerminalErrorMessage("Pi session is no longer available.")));
          websocket.close(1008, "pi session not found");
          return;
        }

        if (clientMessage.type === "input") {
          session.write(clientMessage.data);
          return;
        }

        if (clientMessage.type === "resize") {
          session.resize(clientMessage.cols, clientMessage.rows);
          return;
        }

        if (websocket.data.sessionId !== undefined) {
          closePiSession(websocket.data.sessionId, piSessions);
        }

        websocket.close(normalClosureCode, "pi session closed");
      },
      async open(websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>): Promise<void> {
        websocket.subscribe(websocket.data.topicName);

        if (websocket.data.topicName === healthTopicName) {
          const healthMessage: string | null = await resolveHealthMessage();

          if (healthMessage === null) {
            return;
          }

          lastPublishedMessage = healthMessage;
          websocket.send(healthMessage);
          return;
        }

        if (websocket.data.topicName === logsTopicName) {
          websocket.send(JSON.stringify(createServiceLogSnapshotMessage(retainedLogEntries)));
          return;
        }

        const session: IPiTerminalSessionState | undefined = readPiSession(websocket.data.sessionId, piSessions);

        if (session === undefined) {
          websocket.send(JSON.stringify(createPiTerminalErrorMessage("Pi session is no longer available.")));
          websocket.close(1008, "pi session not found");
          return;
        }

        cancelIdlePiSessionShutdown(session);
        session.sockets.add(websocket);
        websocket.send(JSON.stringify(createPiTerminalSnapshotMessage(session.outputBuffer)));

        if (session.exited !== null) {
          websocket.send(JSON.stringify(createPiTerminalExitMessage(session.exited.exitCode, session.exited.signalCode)));
        }
      },
      close(websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>): void {
        websocket.unsubscribe(websocket.data.topicName);

        if (websocket.data.topicName !== piSessionTopicName) {
          return;
        }

        const session: IPiTerminalSessionState | undefined = readPiSession(websocket.data.sessionId, piSessions);

        if (session === undefined) {
          return;
        }

        session.sockets.delete(websocket);

        if (session.sockets.size === 0 && websocket.data.sessionId !== undefined) {
          scheduleIdlePiSessionShutdown(websocket.data.sessionId, session, piSessions);
        }
      },
    },
  });
  const serverPort: number | undefined = server.port;

  if (serverPort === undefined) {
    throw new Error("Failed to start devtools control server: no port was assigned.");
  }

  const pollIntervalId: ReturnType<typeof setInterval> = setInterval((): void => {
    if (server.subscriberCount(healthTopicName) === 0) {
      return;
    }

    void publishHealthResponse();
  }, healthPollIntervalInMilliseconds);

  return {
    port: serverPort,
    publishHealthResponse,
    publishLogEntry,
    stop: async (): Promise<void> => {
      isStopped = true;
      clearInterval(pollIntervalId);

      for (const [sessionId] of piSessions) {
        closePiSession(sessionId, piSessions);
      }

      void server.stop(true);
    },
  };

  function appendPiTerminalOutput(sessionId: string, data: Uint8Array): void {
    const session: IPiTerminalSessionState | undefined = piSessions.get(sessionId);

    if (session === undefined) {
      return;
    }

    const outputChunk: string = session.decoder.decode(data, { stream: true });

    if (outputChunk.length === 0) {
      return;
    }

    session.outputBuffer = retainTerminalBufferTail(session.outputBuffer + outputChunk);
    publishPiTerminalMessage(session, createPiTerminalOutputMessage(outputChunk));
  }

  function createPiSession(annotation: IAnnotationSubmitDetail): string {
    const sessionId: string = crypto.randomUUID();
    const startPiTerminalSession =
      options.startPiTerminalSession ??
      (() => {
        throw new Error("Pi terminal session launching is not configured.");
      });
    const launchedSession: ILaunchedPiTerminalSession = startPiTerminalSession(
      annotation,
      (data: Uint8Array): void => {
        appendPiTerminalOutput(sessionId, data);
      },
    );
    const session: IPiTerminalSessionState = {
      close: launchedSession.close,
      decoder: new TextDecoder(),
      exited: null,
      idleTimeoutId: null,
      outputBuffer: "",
      resize: launchedSession.resize,
      sockets: new Set<Bun.ServerWebSocket<DevtoolsWebSocketData>>(),
      write: launchedSession.write,
    };

    piSessions.set(sessionId, session);
    scheduleIdlePiSessionShutdown(sessionId, session, piSessions);
    void launchedSession.childProcess.exited.then((exitCode: number): void => {
      const activeSession: IPiTerminalSessionState | undefined = piSessions.get(sessionId);

      if (activeSession === undefined) {
        return;
      }

      const trailingOutput: string = activeSession.decoder.decode();

      if (trailingOutput.length > 0) {
        activeSession.outputBuffer = retainTerminalBufferTail(activeSession.outputBuffer + trailingOutput);
        publishPiTerminalMessage(activeSession, createPiTerminalOutputMessage(trailingOutput));
      }

      activeSession.exited = {
        exitCode,
        signalCode: launchedSession.childProcess.signalCode,
      };
      publishPiTerminalMessage(activeSession, createPiTerminalExitMessage(exitCode, launchedSession.childProcess.signalCode));

      if (activeSession.sockets.size === 0) {
        scheduleIdlePiSessionShutdown(sessionId, activeSession, piSessions);
      }
    });

    return sessionId;
  }

  async function publishHealthResponse(): Promise<void> {
    if (isStopped) {
      return;
    }

    const healthMessage: string | null = await resolveHealthMessage();

    if (healthMessage === null || healthMessage === lastPublishedMessage) {
      return;
    }

    lastPublishedMessage = healthMessage;

    if (server.subscriberCount(healthTopicName) > 0) {
      server.publish(healthTopicName, healthMessage);
    }
  }

  function publishLogEntry(serviceName: string, stream: ServiceLogStream, line: string): void {
    if (isStopped) {
      return;
    }

    const logEntry: ServiceLogEntry = {
      id: nextLogEntryId,
      line,
      serviceName,
      stream,
    };
    const updateMessage: string = JSON.stringify(createServiceLogUpdateMessage(logEntry));

    nextLogEntryId += 1;
    retainedLogEntries.push(logEntry);

    if (retainedLogEntries.length > maximumRetainedLogEntries) {
      retainedLogEntries.splice(0, retainedLogEntries.length - maximumRetainedLogEntries);
    }

    if (server.subscriberCount(logsTopicName) > 0) {
      server.publish(logsTopicName, updateMessage);
    }
  }

  async function resolveHealthMessage(): Promise<string | null> {
    try {
      return JSON.stringify(await options.getHealthResponse());
    } catch {
      return null;
    }
  }
}

function cancelIdlePiSessionShutdown(session: IPiTerminalSessionState): void {
  if (session.idleTimeoutId === null) {
    return;
  }

  clearTimeout(session.idleTimeoutId);
  session.idleTimeoutId = null;
}

function closePiSession(sessionId: string, piSessions: Map<string, IPiTerminalSessionState>): void {
  const session: IPiTerminalSessionState | undefined = piSessions.get(sessionId);

  if (session === undefined) {
    return;
  }

  cancelIdlePiSessionShutdown(session);

  for (const websocket of session.sockets) {
    websocket.close(normalClosureCode, "pi session closed");
  }

  session.sockets.clear();
  session.close();
  piSessions.delete(sessionId);
}

function createPiTerminalErrorMessage(message: string): PiTerminalServerMessage {
  return {
    message,
    type: "error",
  };
}

function createPiTerminalExitMessage(exitCode: number | null, signalCode: string | null): PiTerminalServerMessage {
  return {
    exitCode,
    signalCode,
    type: "exit",
  };
}

function createPiTerminalOutputMessage(data: string): PiTerminalServerMessage {
  return {
    data,
    type: "output",
  };
}

function createPiTerminalSnapshotMessage(data: string): PiTerminalServerMessage {
  return {
    data,
    type: "snapshot",
  };
}

function createServiceLogSnapshotMessage(entries: ServiceLogEntry[]): ServiceLogSnapshotMessage {
  return {
    entries,
    type: "snapshot",
  };
}

function createServiceLogUpdateMessage(entry: ServiceLogEntry): ServiceLogUpdateMessage {
  return {
    entry,
    type: "entry",
  };
}

function isAnnotationMarkerPayload(value: unknown): value is IAnnotationMarkerPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const accessibility: unknown = Reflect.get(value, "accessibility");
  const boundingBox: unknown = Reflect.get(value, "boundingBox");
  const computedStyles: unknown = Reflect.get(value, "computedStyles");
  const computedStylesObj: unknown = Reflect.get(value, "computedStylesObj");
  const cssClasses: unknown = Reflect.get(value, "cssClasses");
  const element: unknown = Reflect.get(value, "element");
  const elementPath: unknown = Reflect.get(value, "elementPath");
  const fullPath: unknown = Reflect.get(value, "fullPath");
  const isFixed: unknown = Reflect.get(value, "isFixed");
  const markerNumber: unknown = Reflect.get(value, "markerNumber");
  const nearbyElements: unknown = Reflect.get(value, "nearbyElements");
  const nearbyText: unknown = Reflect.get(value, "nearbyText");
  const selectedText: unknown = Reflect.get(value, "selectedText");

  return (
    typeof accessibility === "string" &&
    isRectSnapshot(boundingBox) &&
    typeof computedStyles === "string" &&
    isStringRecord(computedStylesObj) &&
    typeof cssClasses === "string" &&
    typeof element === "string" &&
    typeof elementPath === "string" &&
    typeof fullPath === "string" &&
    typeof isFixed === "boolean" &&
    typeof markerNumber === "number" &&
    typeof nearbyElements === "string" &&
    typeof nearbyText === "string" &&
    (typeof selectedText === "string" || selectedText === undefined)
  );
}

function isAnnotationSubmitDetail(value: unknown): value is IAnnotationSubmitDetail {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const comment: unknown = Reflect.get(value, "comment");
  const markers: unknown = Reflect.get(value, "markers");
  const stackName: unknown = Reflect.get(value, "stackName");
  const submittedAt: unknown = Reflect.get(value, "submittedAt");
  const title: unknown = Reflect.get(value, "title");
  const url: unknown = Reflect.get(value, "url");

  return (
    typeof comment === "string" &&
    Array.isArray(markers) &&
    markers.every((marker: unknown): marker is IAnnotationMarkerPayload => isAnnotationMarkerPayload(marker)) &&
    typeof stackName === "string" &&
    typeof submittedAt === "number" &&
    typeof title === "string" &&
    typeof url === "string"
  );
}

function isAuthorizedControlRequest(request: Request, controlToken: string): boolean {
  return request.headers.get(DEVTOOLS_CONTROL_TOKEN_HEADER_NAME) === controlToken;
}

function isRectSnapshot(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const height: unknown = Reflect.get(value, "height");
  const width: unknown = Reflect.get(value, "width");
  const x: unknown = Reflect.get(value, "x");
  const y: unknown = Reflect.get(value, "y");

  return typeof height === "number" && typeof width === "number" && typeof x === "number" && typeof y === "number";
}

function isStartPiSessionRequest(value: unknown): value is IStartPiSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const annotation: unknown = Reflect.get(value, "annotation");

  return isAnnotationSubmitDetail(annotation);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.values(value).every((entry: unknown): boolean => typeof entry === "string");
}

function parsePiTerminalClientMessage(messageText: string): PiTerminalClientMessage | null {
  const parsedValue: unknown = JSON.parse(messageText);

  if (typeof parsedValue !== "object" || parsedValue === null) {
    return null;
  }

  const messageType: unknown = Reflect.get(parsedValue, "type");

  if (messageType === "input") {
    const data: unknown = Reflect.get(parsedValue, "data");

    if (typeof data !== "string") {
      return null;
    }

    return {
      data,
      type: "input",
    };
  }

  if (messageType === "resize") {
    const cols: unknown = Reflect.get(parsedValue, "cols");
    const rows: unknown = Reflect.get(parsedValue, "rows");

    if (
      typeof cols !== "number" ||
      typeof rows !== "number" ||
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols <= 0 ||
      rows <= 0
    ) {
      return null;
    }

    return {
      cols,
      rows,
      type: "resize",
    };
  }

  if (messageType === "close") {
    return {
      type: "close",
    };
  }

  return null;
}

function publishPiTerminalMessage(session: IPiTerminalSessionState, message: PiTerminalServerMessage): void {
  const serializedMessage: string = JSON.stringify(message);

  for (const websocket of session.sockets) {
    if (websocket.readyState !== WebSocket.OPEN) {
      continue;
    }

    websocket.send(serializedMessage);
  }
}

function readPiSession(
  sessionId: string | undefined,
  piSessions: Map<string, IPiTerminalSessionState>,
): IPiTerminalSessionState | undefined {
  if (sessionId === undefined) {
    return undefined;
  }

  return piSessions.get(sessionId);
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function retainTerminalBufferTail(outputBuffer: string): string {
  if (outputBuffer.length <= maximumRetainedTerminalOutputCharacters) {
    return outputBuffer;
  }

  return outputBuffer.slice(outputBuffer.length - maximumRetainedTerminalOutputCharacters);
}

function scheduleIdlePiSessionShutdown(
  sessionId: string,
  session: IPiTerminalSessionState,
  piSessions: Map<string, IPiTerminalSessionState>,
): void {
  cancelIdlePiSessionShutdown(session);
  session.idleTimeoutId = setTimeout((): void => {
    closePiSession(sessionId, piSessions);
  }, idlePiSessionTimeoutInMilliseconds);
}

const normalClosureCode: number = 1000;
