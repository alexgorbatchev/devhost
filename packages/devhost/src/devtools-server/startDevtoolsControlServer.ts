import { fileURLToPath } from "node:url";

import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { createConfiguredDevtoolsScript } from "./createConfiguredDevtoolsScript";
import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { IAnnotationMarkerPayload, IAnnotationSubmitDetail } from "../devtools/features/annotationComposer/types";
import type {
  IActiveTerminalSessionSnapshot,
  IListTerminalSessionsResponse,
  StartTerminalSessionRequest,
  TerminalSessionClientMessage,
  TerminalSessionServerMessage,
} from "../devtools/features/terminalSessions/types";
import type { ISourceLocation } from "../devtools/shared/sourceLocation";
import {
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
  HEALTH_WEBSOCKET_PATH,
  INJECTED_SCRIPT_PATH,
  LOGS_WEBSOCKET_PATH,
  maximumRetainedLogEntries,
  RESTART_SERVICE_PATH,
  TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_START_PATH,
  TERMINAL_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "../devtools/shared/constants";
import type {
  HealthResponse,
  ServiceLogEntry,
  ServiceLogSnapshotMessage,
  ServiceLogStream,
  ServiceLogUpdateMessage,
  WebSocketMessageData,
} from "../devtools/shared/types";
import type { ILaunchedTerminalSession } from "../agents/launchTerminalSession";
import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../types/stackTypes";

import { createAgentSessionFiles } from "../agents/createAgentSessionFiles";
import { createAnnotationAgentPrompt } from "../agents/createAnnotationAgentPrompt";

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
  agentDisplayName: string;
  componentEditor: DevtoolsComponentEditor;
  devtoolsMinimapPosition: DevtoolsMinimapPosition;
  devtoolsPosition: DevtoolsPosition;
  editorEnabled?: boolean;
  minimapEnabled?: boolean;
  statusEnabled?: boolean;
  getHealthResponse: () => Promise<HealthResponse>;
  projectRootPath: string;
  restartService?: (serviceName: string) => Promise<void>;
  stackName: string;
  startTerminalSession?: (
    request: StartTerminalSessionRequest,
    onData: (data: Uint8Array) => void,
  ) => ILaunchedTerminalSession;
}

interface ITerminalSessionExitStatus {
  exitCode: number | null;
  signalCode: string | null;
}

interface ITerminalSessionState {
  cleanupFiles: (() => void)[];
  close: () => void;
  decoder: TextDecoder;
  exited: ITerminalSessionExitStatus | null;
  idleTimeoutId: ReturnType<typeof setTimeout> | null;
  outputBuffer: string;
  request: StartTerminalSessionRequest;
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
    options.agentDisplayName,
    controlToken,
    options.editorEnabled ?? true,
    options.minimapEnabled ?? true,
    options.statusEnabled ?? true,
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

      if (requestUrl.pathname === RESTART_SERVICE_PATH) {
        if (!isAuthorizedControlRequest(request, controlToken)) {
          return new Response("Forbidden", { status: 403 });
        }

        if (request.method.toUpperCase() === "POST") {
          const requestBody: unknown = await readRequestJson(request);

          if (
            typeof requestBody !== "object" ||
            requestBody === null ||
            typeof (requestBody as Record<string, unknown>).serviceName !== "string"
          ) {
            return new Response("Invalid restart service payload.", { status: 400 });
          }

          if (options.restartService) {
            try {
              await options.restartService((requestBody as Record<string, string>).serviceName);
              return Response.json({ success: true });
            } catch (error) {
              const message: string = error instanceof Error ? error.message : String(error);
              return new Response(message, { status: 500 });
            }
          }

          return new Response("Restart service not supported.", { status: 501 });
        }

        return new Response("Method not allowed", { status: 405 });
      }

      if (requestUrl.pathname === TERMINAL_SESSION_START_PATH) {
        if (!isAuthorizedControlRequest(request, controlToken)) {
          return new Response("Forbidden", { status: 403 });
        }

        if (request.method.toUpperCase() === "GET") {
          return Response.json(createTerminalSessionListResponse(terminalSessions));
        }

        if (request.method.toUpperCase() === "POST") {
          const requestBody: unknown = await readRequestJson(request);

          if (!isStartTerminalSessionRequest(requestBody)) {
            return new Response("Invalid terminal session payload.", { status: 400 });
          }

          try {
            if (requestBody.kind === "agent" && requestBody.targetSessionId) {
              const targetSession = terminalSessions.get(requestBody.targetSessionId);

              if (targetSession !== undefined && targetSession.exited === null) {
                const promptText = createAnnotationAgentPrompt(requestBody.annotation);
                const sessionFiles = createAgentSessionFiles({
                  annotation: requestBody.annotation,
                  displayName: options.agentDisplayName,
                  projectRootPath: options.projectRootPath,
                  prompt: promptText,
                  stackName: options.stackName,
                });

                targetSession.cleanupFiles.push(sessionFiles.cleanup);
                const inputText = `Please read the annotation details from ${sessionFiles.env.DEVHOST_AGENT_PROMPT_FILE} and address the requested change.\r`;
                targetSession.write(inputText);

                return Response.json({
                  sessionId: requestBody.targetSessionId,
                });
              }
            }

            const sessionId: string = createTerminalSession(requestBody);

            return Response.json({
              sessionId,
            });
          } catch (error) {
            const message: string = error instanceof Error ? error.message : String(error);

            return new Response(message, { status: 500 });
          }
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
        const requestControlToken: string | null = requestUrl.searchParams.get(
          DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
        );

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
      message(websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>, message: WebSocketMessageData): void {
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

        const session: ITerminalSessionState | undefined = readTerminalSession(
          websocket.data.sessionId,
          terminalSessions,
        );

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

        const session: ITerminalSessionState | undefined = readTerminalSession(
          websocket.data.sessionId,
          terminalSessions,
        );

        if (session === undefined) {
          websocket.send(JSON.stringify(createTerminalSessionErrorMessage("Terminal session is no longer available.")));
          websocket.close(1008, "terminal session not found");
          return;
        }

        cancelIdleTerminalSessionShutdown(session);
        session.sockets.add(websocket);
        websocket.send(JSON.stringify(createTerminalSessionSnapshotMessage(session.outputBuffer)));

        if (session.exited !== null) {
          websocket.send(
            JSON.stringify(createTerminalSessionExitMessage(session.exited.exitCode, session.exited.signalCode)),
          );
        }
      },
      close(websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>): void {
        websocket.unsubscribe(websocket.data.topicName);

        if (websocket.data.topicName !== terminalSessionTopicName) {
          return;
        }

        const session: ITerminalSessionState | undefined = readTerminalSession(
          websocket.data.sessionId,
          terminalSessions,
        );

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

  function createTerminalSession(request: StartTerminalSessionRequest): string {
    const sessionId: string = crypto.randomUUID();
    const startTerminalSession =
      options.startTerminalSession ??
      (() => {
        throw new Error("Terminal session launching is not configured.");
      });
    const launchedSession: ILaunchedTerminalSession = startTerminalSession(request, (data: Uint8Array): void => {
      appendTerminalSessionOutput(sessionId, data);
    });
    const session: ITerminalSessionState = {
      cleanupFiles: [],
      close: launchedSession.close,
      decoder: new TextDecoder(),
      exited: null,
      idleTimeoutId: null,
      outputBuffer: "",
      request,
      resize: launchedSession.resize,
      sockets: new Set<Bun.ServerWebSocket<DevtoolsWebSocketData>>(),
      write: launchedSession.write,
    };

    terminalSessions.set(sessionId, session);
    scheduleIdleTerminalSessionShutdown(sessionId, session, terminalSessions);
    void launchedSession.childProcess.exited
      .then((exitCode: number): void => {
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
        publishTerminalSessionMessage(
          activeSession,
          createTerminalSessionExitMessage(exitCode, launchedSession.childProcess.signalCode),
        );

        if (activeSession.sockets.size === 0) {
          scheduleIdleTerminalSessionShutdown(sessionId, activeSession, terminalSessions);
        }
      })
      .finally((): void => {
        launchedSession.cleanup();
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

  for (const cleanup of session.cleanupFiles) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup errors
    }
  }

  session.sockets.clear();
  session.close();
  terminalSessions.delete(sessionId);
}

function createTerminalSessionListResponse(
  terminalSessions: Map<string, ITerminalSessionState>,
): IListTerminalSessionsResponse {
  const sessions: IActiveTerminalSessionSnapshot[] = Array.from(terminalSessions.entries()).map(
    ([sessionId, session]): IActiveTerminalSessionSnapshot => {
      return {
        request: session.request,
        sessionId,
      };
    },
  );

  return { sessions };
}

function createTerminalSessionErrorMessage(message: string): TerminalSessionServerMessage {
  return {
    message,
    type: "error",
  };
}

function createTerminalSessionExitMessage(
  exitCode: number | null,
  signalCode: string | null,
): TerminalSessionServerMessage {
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

  const target = value as Record<string, unknown>;
  const accessibility = target.accessibility;
  const boundingBox = target.boundingBox;
  const computedStyles = target.computedStyles;
  const computedStylesObj = target.computedStylesObj;
  const cssClasses = target.cssClasses;
  const element = target.element;
  const elementPath = target.elementPath;
  const fullPath = target.fullPath;
  const isFixed = target.isFixed;
  const markerNumber = target.markerNumber;
  const nearbyElements = target.nearbyElements;
  const nearbyText = target.nearbyText;
  const selectedText = target.selectedText;

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

  const target = value as Record<string, unknown>;
  const comment = target.comment;
  const markers = target.markers;
  const stackName = target.stackName;
  const submittedAt = target.submittedAt;
  const title = target.title;
  const url = target.url;

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

  const target = value as Record<string, unknown>;
  const height = target.height;
  const width = target.width;
  const x = target.x;
  const y = target.y;

  return typeof height === "number" && typeof width === "number" && typeof x === "number" && typeof y === "number";
}

function isSourceLocation(value: unknown): value is ISourceLocation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const target = value as Record<string, unknown>;
  const fileName = target.fileName;
  const lineNumber = target.lineNumber;
  const columnNumber = target.columnNumber;
  const componentName = target.componentName;

  return (
    typeof fileName === "string" &&
    typeof lineNumber === "number" &&
    Number.isInteger(lineNumber) &&
    lineNumber > 0 &&
    (columnNumber === undefined ||
      (typeof columnNumber === "number" && Number.isInteger(columnNumber) && columnNumber > 0)) &&
    (componentName === undefined || typeof componentName === "string")
  );
}

function isStartTerminalSessionRequest(value: unknown): value is StartTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const target = value as Record<string, unknown>;
  const requestKind = target.kind;
  const launcher = target.launcher;

  if (requestKind === "agent") {
    const annotation = target.annotation;
    const targetSessionId = target.targetSessionId;

    if (targetSessionId !== undefined && typeof targetSessionId !== "string") {
      return false;
    }

    return isAnnotationSubmitDetail(annotation);
  }

  if (requestKind === "editor") {
    const componentName = target.componentName;
    const source = target.source;
    const sourceLabel = target.sourceLabel;

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

  const target = parsedValue as Record<string, unknown>;
  const messageType = target.type;

  if (messageType === "input") {
    const data = target.data;

    if (typeof data !== "string") {
      return null;
    }

    return {
      data,
      type: "input",
    };
  }

  if (messageType === "resize") {
    const cols = target.cols;
    const rows = target.rows;

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
