import { fileURLToPath } from "node:url";

import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { createConfiguredDevtoolsScript } from "./createConfiguredDevtoolsScript";
import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { IAnnotationMarkerPayload, IAnnotationSubmitDetail } from "./devtools/features/annotationComposer/types";
import type {
  IStartTerminalSessionRequest,
  TerminalSessionClientMessage,
  TerminalSessionServerMessage,
} from "./devtools/features/terminalSessions/types";
import type { ISourceLocation } from "./devtools/shared/sourceLocation";
import {
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
  HEALTH_WEBSOCKET_PATH,
  INJECTED_SCRIPT_PATH,
  LOGS_WEBSOCKET_PATH,
  maximumRetainedLogEntries,
  TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_START_PATH,
  TERMINAL_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "./devtools/shared/constants";
import type {
  HealthResponse,
  ServiceLogEntry,
  ServiceLogSnapshotMessage,
  ServiceLogStream,
  ServiceLogUpdateMessage,
} from "./devtools/shared/types";
import type { ILaunchedTerminalSession } from "./launchTerminalSession";
import type { DevtoolsMinimapPosition, DevtoolsPosition } from "./stackTypes";

const healthTopicName: string = "devhost-health";
const logsTopicName: string = "devhost-logs";
const terminalSessionTopicName: string = "devhost-terminal-session";
const healthPollIntervalInMilliseconds: number = 1_000;
const idleTerminalSessionTimeoutInMilliseconds: number = 10_000;
const maximumRetainedTerminalOutputCharacters: number = 128_000;
const xtermStylesheetFilePath: string = fileURLToPath(import.meta.resolve("@xterm/xterm/css/xterm.css"));

type WebSocketTopicName = typeof healthTopicName | typeof logsTopicName | typeof terminalSessionTopicName;

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
  componentEditor: DevtoolsComponentEditor;
  devtoolsMinimapPosition: DevtoolsMinimapPosition;
  devtoolsPosition: DevtoolsPosition;
  getHealthResponse: () => Promise<HealthResponse>;
  projectRootPath: string;
  stackName: string;
  startTerminalSession?: (
    request: IStartTerminalSessionRequest,
    onData: (data: Uint8Array) => void,
  ) => ILaunchedTerminalSession;
}

interface ITerminalSessionExitStatus {
  exitCode: number | null;
  signalCode: string | null;
}

interface ITerminalSessionState {
  close: () => void;
  decoder: TextDecoder;
  exited: ITerminalSessionExitStatus | null;
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
    options.componentEditor,
    options.projectRootPath,
    options.stackName,
    controlToken,
  );
  const retainedLogEntries: ServiceLogEntry[] = [];
  const terminalSessions: Map<string, ITerminalSessionState> = new Map<string, ITerminalSessionState>();
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

      if (requestUrl.pathname === TERMINAL_SESSION_START_PATH && request.method.toUpperCase() === "POST") {
        if (!isAuthorizedControlRequest(request, controlToken)) {
          return new Response("Forbidden", { status: 403 });
        }

        const requestBody: unknown = await readRequestJson(request);

        if (!isStartTerminalSessionRequest(requestBody)) {
          return new Response("Invalid terminal session payload.", { status: 400 });
        }

        try {
          const sessionId: string = createTerminalSession(requestBody);

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

      if (requestUrl.pathname === TERMINAL_SESSION_WEBSOCKET_PATH) {
        const sessionId: string | null = requestUrl.searchParams.get(TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME);
        const requestControlToken: string | null = requestUrl.searchParams.get(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME);

        if (requestControlToken !== controlToken) {
          return new Response("Forbidden", { status: 403 });
        }

        if (sessionId === null || sessionId.length === 0) {
          return new Response("Missing sessionId query parameter.", { status: 400 });
        }

        if (!terminalSessions.has(sessionId)) {
          return new Response("Terminal session was not found.", { status: 404 });
        }

        const didUpgrade: boolean = bunServer.upgrade(request, {
          data: {
            sessionId,
            topicName: terminalSessionTopicName,
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
        if (websocket.data.topicName !== terminalSessionTopicName) {
          return;
        }

        if (typeof message !== "string") {
          websocket.send(JSON.stringify(createTerminalSessionErrorMessage("Terminal messages must be text frames.")));
          return;
        }

        const clientMessage: TerminalSessionClientMessage | null = parseTerminalSessionClientMessage(message);

        if (clientMessage === null) {
          websocket.send(JSON.stringify(createTerminalSessionErrorMessage("Invalid terminal message.")));
          return;
        }

        const session: ITerminalSessionState | undefined = readTerminalSession(websocket.data.sessionId, terminalSessions);

        if (session === undefined) {
          websocket.send(JSON.stringify(createTerminalSessionErrorMessage("Terminal session is no longer available.")));
          websocket.close(1008, "terminal session not found");
          return;
        }

        if (clientMessage.type === "input") {
          if (session.exited === null) {
            session.write(clientMessage.data);
          }

          return;
        }

        if (clientMessage.type === "resize") {
          if (session.exited === null) {
            session.resize(clientMessage.cols, clientMessage.rows);
          }

          return;
        }

        if (websocket.data.sessionId !== undefined) {
          closeTerminalSession(websocket.data.sessionId, terminalSessions);
        }

        websocket.close(normalClosureCode, "terminal session closed");
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

        const session: ITerminalSessionState | undefined = readTerminalSession(websocket.data.sessionId, terminalSessions);

        if (session === undefined) {
          websocket.send(JSON.stringify(createTerminalSessionErrorMessage("Terminal session is no longer available.")));
          websocket.close(1008, "terminal session not found");
          return;
        }

        cancelIdleTerminalSessionShutdown(session);
        session.sockets.add(websocket);
        websocket.send(JSON.stringify(createTerminalSessionSnapshotMessage(session.outputBuffer)));

        if (session.exited !== null) {
          websocket.send(JSON.stringify(createTerminalSessionExitMessage(session.exited.exitCode, session.exited.signalCode)));
        }
      },
      close(websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>): void {
        websocket.unsubscribe(websocket.data.topicName);

        if (websocket.data.topicName !== terminalSessionTopicName) {
          return;
        }

        const session: ITerminalSessionState | undefined = readTerminalSession(websocket.data.sessionId, terminalSessions);

        if (session === undefined) {
          return;
        }

        session.sockets.delete(websocket);

        if (session.sockets.size === 0 && websocket.data.sessionId !== undefined) {
          scheduleIdleTerminalSessionShutdown(websocket.data.sessionId, session, terminalSessions);
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

      for (const [sessionId] of terminalSessions) {
        closeTerminalSession(sessionId, terminalSessions);
      }

      void server.stop(true);
    },
  };

  function appendTerminalSessionOutput(sessionId: string, data: Uint8Array): void {
    const session: ITerminalSessionState | undefined = terminalSessions.get(sessionId);

    if (session === undefined) {
      return;
    }

    const outputChunk: string = session.decoder.decode(data, { stream: true });

    if (outputChunk.length === 0) {
      return;
    }

    session.outputBuffer = retainTerminalBufferTail(session.outputBuffer + outputChunk);
    publishTerminalSessionMessage(session, createTerminalSessionOutputMessage(outputChunk));
  }

  function createTerminalSession(request: IStartTerminalSessionRequest): string {
    const sessionId: string = crypto.randomUUID();
    const startTerminalSession =
      options.startTerminalSession ??
      (() => {
        throw new Error("Terminal session launching is not configured.");
      });
    const launchedSession: ILaunchedTerminalSession = startTerminalSession(
      request,
      (data: Uint8Array): void => {
        appendTerminalSessionOutput(sessionId, data);
      },
    );
    const session: ITerminalSessionState = {
      close: launchedSession.close,
      decoder: new TextDecoder(),
      exited: null,
      idleTimeoutId: null,
      outputBuffer: "",
      resize: launchedSession.resize,
      sockets: new Set<Bun.ServerWebSocket<DevtoolsWebSocketData>>(),
      write: launchedSession.write,
    };

    terminalSessions.set(sessionId, session);
    scheduleIdleTerminalSessionShutdown(sessionId, session, terminalSessions);
    void launchedSession.childProcess.exited.then((exitCode: number): void => {
      const activeSession: ITerminalSessionState | undefined = terminalSessions.get(sessionId);

      if (activeSession === undefined) {
        return;
      }

      const trailingOutput: string = activeSession.decoder.decode();

      if (trailingOutput.length > 0) {
        activeSession.outputBuffer = retainTerminalBufferTail(activeSession.outputBuffer + trailingOutput);
        publishTerminalSessionMessage(activeSession, createTerminalSessionOutputMessage(trailingOutput));
      }

      activeSession.exited = {
        exitCode,
        signalCode: launchedSession.childProcess.signalCode,
      };
      publishTerminalSessionMessage(activeSession, createTerminalSessionExitMessage(exitCode, launchedSession.childProcess.signalCode));

      if (activeSession.sockets.size === 0) {
        scheduleIdleTerminalSessionShutdown(sessionId, activeSession, terminalSessions);
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

function cancelIdleTerminalSessionShutdown(session: ITerminalSessionState): void {
  if (session.idleTimeoutId === null) {
    return;
  }

  clearTimeout(session.idleTimeoutId);
  session.idleTimeoutId = null;
}

function closeTerminalSession(sessionId: string, terminalSessions: Map<string, ITerminalSessionState>): void {
  const session: ITerminalSessionState | undefined = terminalSessions.get(sessionId);

  if (session === undefined) {
    return;
  }

  cancelIdleTerminalSessionShutdown(session);

  for (const websocket of session.sockets) {
    websocket.close(normalClosureCode, "terminal session closed");
  }

  session.sockets.clear();
  session.close();
  terminalSessions.delete(sessionId);
}

function createTerminalSessionErrorMessage(message: string): TerminalSessionServerMessage {
  return {
    message,
    type: "error",
  };
}

function createTerminalSessionExitMessage(exitCode: number | null, signalCode: string | null): TerminalSessionServerMessage {
  return {
    exitCode,
    signalCode,
    type: "exit",
  };
}

function createTerminalSessionOutputMessage(data: string): TerminalSessionServerMessage {
  return {
    data,
    type: "output",
  };
}

function createTerminalSessionSnapshotMessage(data: string): TerminalSessionServerMessage {
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

function isSourceLocation(value: unknown): value is ISourceLocation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const fileName: unknown = Reflect.get(value, "fileName");
  const lineNumber: unknown = Reflect.get(value, "lineNumber");
  const columnNumber: unknown = Reflect.get(value, "columnNumber");
  const componentName: unknown = Reflect.get(value, "componentName");

  return (
    typeof fileName === "string" &&
    typeof lineNumber === "number" &&
    Number.isInteger(lineNumber) &&
    lineNumber > 0 &&
    (columnNumber === undefined || (typeof columnNumber === "number" && Number.isInteger(columnNumber) && columnNumber > 0)) &&
    (componentName === undefined || typeof componentName === "string")
  );
}

function isStartTerminalSessionRequest(value: unknown): value is IStartTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const requestKind: unknown = Reflect.get(value, "kind");
  const launcher: unknown = Reflect.get(value, "launcher");

  if (requestKind === "agent") {
    const annotation: unknown = Reflect.get(value, "annotation");

    return launcher === "pi" && isAnnotationSubmitDetail(annotation);
  }

  if (requestKind === "editor") {
    const componentName: unknown = Reflect.get(value, "componentName");
    const source: unknown = Reflect.get(value, "source");
    const sourceLabel: unknown = Reflect.get(value, "sourceLabel");

    return (
      launcher === "neovim" &&
      typeof componentName === "string" &&
      isSourceLocation(source) &&
      typeof sourceLabel === "string"
    );
  }

  return false;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.values(value).every((entry: unknown): boolean => typeof entry === "string");
}

function parseTerminalSessionClientMessage(messageText: string): TerminalSessionClientMessage | null {
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

function publishTerminalSessionMessage(session: ITerminalSessionState, message: TerminalSessionServerMessage): void {
  const serializedMessage: string = JSON.stringify(message);

  for (const websocket of session.sockets) {
    if (websocket.readyState !== WebSocket.OPEN) {
      continue;
    }

    websocket.send(serializedMessage);
  }
}

function readTerminalSession(
  sessionId: string | undefined,
  terminalSessions: Map<string, ITerminalSessionState>,
): ITerminalSessionState | undefined {
  if (sessionId === undefined) {
    return undefined;
  }

  return terminalSessions.get(sessionId);
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

function scheduleIdleTerminalSessionShutdown(
  sessionId: string,
  session: ITerminalSessionState,
  terminalSessions: Map<string, ITerminalSessionState>,
): void {
  cancelIdleTerminalSessionShutdown(session);
  session.idleTimeoutId = setTimeout((): void => {
    closeTerminalSession(sessionId, terminalSessions);
  }, idleTerminalSessionTimeoutInMilliseconds);
}

const normalClosureCode: number = 1000;
