import { fileURLToPath } from "node:url";

import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { createConfiguredDevtoolsScript } from "./createConfiguredDevtoolsScript";
import type { DevtoolsComponentEditor } from "./devtoolsComponentEditor";
import type { IAnnotationMarkerPayload, IAnnotationSubmitDetail } from "../devtools/features/annotationComposer/types";
import type {
  IAnnotationQueuesSnapshotMessage,
  IListAnnotationQueuesResponse,
  IResumeAnnotationQueueResponse,
  IUpdateAnnotationQueueEntryRequest,
} from "../devtools/features/annotationQueue/types";
import type {
  IActiveTerminalSessionSnapshot,
  IListTerminalSessionsResponse,
  StartTerminalSessionRequest,
  TerminalSessionClientMessage,
  TerminalSessionServerMessage,
} from "../devtools/features/terminalSessions/types";
import type { ISourceLocation } from "../devtools/shared/sourceLocation";
import {
  ANNOTATION_QUEUES_PATH,
  ANNOTATION_QUEUES_WEBSOCKET_PATH,
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
import type { IRoutedServiceIdentity } from "../devtools/shared/routedServices";
import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../types/stackTypes";
import type { IDevhostLogger } from "../utils/createLogger";

import { createAgentSessionFiles } from "../agents/createAgentSessionFiles";
import { createAnnotationAgentPrompt } from "../agents/createAnnotationAgentPrompt";
import {
  AnnotationQueueConflictError,
  AnnotationQueueNotFoundError,
  AnnotationQueueValidationError,
  createAnnotationQueueStore,
} from "./createAnnotationQueueStore";
import { parseAgentStatusOsc, type AgentSessionStatus } from "./parseAgentStatusOsc";

const healthTopicName: string = "devhost-health";
const logsTopicName: string = "devhost-logs";
const annotationQueuesTopicName: string = "devhost-annotation-queues";
const terminalSessionTopicName: string = "devhost-terminal-session";
const healthPollIntervalInMilliseconds: number = 1_000;
const idleTerminalSessionTimeoutInMilliseconds: number = 10_000;
const maximumRetainedTerminalOutputCharacters: number = 128_000;
const xtermStylesheetFilePath: string = fileURLToPath(import.meta.resolve("@xterm/xterm/css/xterm.css"));

type WebSocketTopicName =
  | typeof annotationQueuesTopicName
  | typeof healthTopicName
  | typeof logsTopicName
  | typeof terminalSessionTopicName;

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
  externalToolbarsEnabled?: boolean;
  minimapEnabled?: boolean;
  statusEnabled?: boolean;
  getHealthResponse: () => Promise<HealthResponse>;
  logger: IDevhostLogger;
  manifestPath: string;
  projectRootPath: string;
  restartService?: (serviceName: string) => Promise<void>;
  routedServices?: IRoutedServiceIdentity[];
  stackName: string;
  stateDirectoryPath: string;
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
  agentStatus: AgentSessionStatus | null;
  agentStatusOscCarryover: string;
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
    options.externalToolbarsEnabled ?? true,
    options.minimapEnabled ?? true,
    options.statusEnabled ?? true,
    options.routedServices ?? [],
  );
  const retainedLogEntries: ServiceLogEntry[] = [];
  const terminalSessions: Map<string, ITerminalSessionState> = new Map<string, ITerminalSessionState>();
  const xtermStylesheetText: string = await Bun.file(xtermStylesheetFilePath).text();
  let isStopped: boolean = false;
  let lastPublishedMessage: string | null = null;
  let nextLogEntryId: number = 1;
  const annotationQueueStore = createAnnotationQueueStore({
    logger: options.logger,
    manifestPath: options.manifestPath,
    onQueuesChanged: (queues) => {
      if (server.subscriberCount(annotationQueuesTopicName) > 0) {
        server.publish(annotationQueuesTopicName, JSON.stringify(createAnnotationQueuesSnapshotMessage(queues)));
      }
    },
    readLiveAgentSession: (sessionId) => {
      const session: ITerminalSessionState | undefined = terminalSessions.get(sessionId);

      if (session === undefined || session.exited !== null || session.request.kind !== "agent") {
        return null;
      }

      return {
        agentStatus: session.agentStatus,
        annotation: session.request.annotation,
        sessionId,
      };
    },
    routedServices: options.routedServices ?? [],
    stackName: options.stackName,
    startAgentSession: (annotation) => {
      return createTerminalSession({
        annotation,
        kind: "agent",
      });
    },
    stateDirectoryPath: options.stateDirectoryPath,
    writeAnnotationToSession: (sessionId, annotation) => {
      const session: ITerminalSessionState | undefined = terminalSessions.get(sessionId);

      if (session === undefined || session.exited !== null || session.request.kind !== "agent") {
        throw new Error(`Agent terminal session ${sessionId} is not available.`);
      }

      const promptText: string = createAnnotationAgentPrompt(annotation);
      const sessionFiles = createAgentSessionFiles({
        annotation,
        displayName: options.agentDisplayName,
        projectRootPath: options.projectRootPath,
        prompt: promptText,
        stackName: options.stackName,
      });

      session.cleanupFiles.push(sessionFiles.cleanup);
      session.write(
        `Please read the annotation details from ${sessionFiles.env.DEVHOST_AGENT_PROMPT_FILE} and address the requested change.\r`,
      );
    },
  });

  function logAnnotationQueueError(action: string, error: unknown): void {
    const message: string = error instanceof Error ? error.message : String(error);

    options.logger.error(`Failed to ${action}. ${message}`);
  }

  function handleAnnotationQueueStatus(sessionId: string, status: AgentSessionStatus): void {
    void annotationQueueStore.handleAgentStatus(sessionId, status).catch((error: unknown): void => {
      logAnnotationQueueError(`handle annotation queue status ${status} for session ${sessionId}`, error);
    });
  }

  function handleAnnotationQueueSessionExit(sessionId: string): void {
    void annotationQueueStore.handleSessionExited(sessionId).catch((error: unknown): void => {
      logAnnotationQueueError(`pause annotation queue for exited session ${sessionId}`, error);
    });
  }

  async function handleIdleTerminalSessionShutdown(sessionId: string): Promise<void> {
    try {
      await annotationQueueStore.handleSessionExited(sessionId);
    } catch (error) {
      logAnnotationQueueError(`pause annotation queue for idle session ${sessionId}`, error);
    }
  }

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

          const serviceName: unknown =
            typeof requestBody === "object" && requestBody !== null
              ? Reflect.get(requestBody, "serviceName")
              : undefined;

          if (typeof serviceName !== "string") {
            return new Response("Invalid restart service payload.", { status: 400 });
          }

          if (options.restartService) {
            try {
              await options.restartService(serviceName);
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
            const sessionId: string =
              requestBody.kind === "agent"
                ? (await annotationQueueStore.enqueue(requestBody.annotation, requestBody.targetSessionId)).sessionId
                : createTerminalSession(requestBody);

            return Response.json({
              sessionId,
            });
          } catch (error) {
            const message: string = error instanceof Error ? error.message : String(error);

            return new Response(message, { status: 500 });
          }
        }
      }

      if (requestUrl.pathname === ANNOTATION_QUEUES_PATH) {
        if (!isAuthorizedControlRequest(request, controlToken)) {
          return new Response("Forbidden", { status: 403 });
        }

        if (request.method.toUpperCase() === "GET") {
          return Response.json(createAnnotationQueuesListResponse(annotationQueueStore.getSnapshot()));
        }

        return new Response("Method not allowed", { status: 405 });
      }

      const queueEntryId = readAnnotationQueueEntryId(requestUrl.pathname);
      const queueIdToResume = readAnnotationQueueResumeId(requestUrl.pathname);

      if (queueEntryId !== null) {
        if (!isAuthorizedControlRequest(request, controlToken)) {
          return new Response("Forbidden", { status: 403 });
        }

        if (request.method.toUpperCase() === "PATCH") {
          const requestBody: unknown = await readRequestJson(request);

          if (!isUpdateAnnotationQueueEntryRequest(requestBody)) {
            return new Response("Invalid annotation queue payload.", { status: 400 });
          }

          try {
            await annotationQueueStore.updateEntryComment(queueEntryId, requestBody.comment);
            return Response.json(createAnnotationQueueMutationResponse());
          } catch (error) {
            return createAnnotationQueueMutationErrorResponse(error);
          }
        }

        if (request.method.toUpperCase() === "DELETE") {
          try {
            await annotationQueueStore.deleteEntry(queueEntryId);
            return Response.json(createAnnotationQueueMutationResponse());
          } catch (error) {
            return createAnnotationQueueMutationErrorResponse(error);
          }
        }

        return new Response("Method not allowed", { status: 405 });
      }

      if (queueIdToResume !== null) {
        if (!isAuthorizedControlRequest(request, controlToken)) {
          return new Response("Forbidden", { status: 403 });
        }

        if (request.method.toUpperCase() === "POST") {
          try {
            const resumeResponse = await annotationQueueStore.resumeQueue(queueIdToResume);
            return Response.json(createResumeAnnotationQueueResponse(resumeResponse.sessionId));
          } catch (error) {
            return createAnnotationQueueMutationErrorResponse(error);
          }
        }

        return new Response("Method not allowed", { status: 405 });
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

      if (requestUrl.pathname === ANNOTATION_QUEUES_WEBSOCKET_PATH) {
        const requestControlToken: string | null = requestUrl.searchParams.get(
          DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
        );

        if (requestControlToken !== controlToken) {
          return new Response("Forbidden", { status: 403 });
        }

        const didUpgrade: boolean = bunServer.upgrade(request, {
          data: {
            topicName: annotationQueuesTopicName,
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
      async message(
        websocket: Bun.ServerWebSocket<DevtoolsWebSocketData>,
        message: WebSocketMessageData,
      ): Promise<void> {
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
          try {
            await annotationQueueStore.handleUserClosedSession(websocket.data.sessionId);
          } catch (error) {
            logAnnotationQueueError(
              `pause annotation queue for user-closed session ${websocket.data.sessionId}`,
              error,
            );
          }

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

        if (websocket.data.topicName === annotationQueuesTopicName) {
          websocket.send(JSON.stringify(createAnnotationQueuesSnapshotMessage(annotationQueueStore.getSnapshot())));
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
          scheduleIdleTerminalSessionShutdown(
            websocket.data.sessionId,
            session,
            terminalSessions,
            handleIdleTerminalSessionShutdown,
          );
        }
      },
    },
  });
  const serverPort: number | undefined = server.port;

  if (serverPort === undefined) {
    throw new Error("Failed to start devtools control server: no port was assigned.");
  }

  await annotationQueueStore.resumePersistedQueues();

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
      await annotationQueueStore.prepareForShutdown();

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

    if (session.request.kind === "agent") {
      const parsedStatuses = parseAgentStatusOsc(session.agentStatusOscCarryover, outputChunk);

      session.agentStatusOscCarryover = parsedStatuses.carryover;

      for (const status of parsedStatuses.statuses) {
        session.agentStatus = status;
        handleAnnotationQueueStatus(sessionId, status);
      }
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
      agentStatus: null,
      agentStatusOscCarryover: "",
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
    scheduleIdleTerminalSessionShutdown(sessionId, session, terminalSessions, handleIdleTerminalSessionShutdown);
    void launchedSession.childProcess.exited
      .then((exitCode: number): void => {
        const activeSession: ITerminalSessionState | undefined = terminalSessions.get(sessionId);

        if (activeSession === undefined) {
          return;
        }

        const trailingOutput: string = activeSession.decoder.decode();

        if (trailingOutput.length > 0) {
          if (activeSession.request.kind === "agent") {
            const parsedStatuses = parseAgentStatusOsc(activeSession.agentStatusOscCarryover, trailingOutput);

            activeSession.agentStatusOscCarryover = parsedStatuses.carryover;

            for (const status of parsedStatuses.statuses) {
              activeSession.agentStatus = status;
              handleAnnotationQueueStatus(sessionId, status);
            }
          }

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

        handleAnnotationQueueSessionExit(sessionId);

        if (activeSession.sockets.size === 0) {
          scheduleIdleTerminalSessionShutdown(
            sessionId,
            activeSession,
            terminalSessions,
            handleIdleTerminalSessionShutdown,
          );
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

function createAnnotationQueuesListResponse(
  queues: IListAnnotationQueuesResponse["queues"],
): IListAnnotationQueuesResponse {
  return { queues };
}

function createAnnotationQueueMutationResponse() {
  return { success: true };
}

function createResumeAnnotationQueueResponse(sessionId: string): IResumeAnnotationQueueResponse {
  return {
    sessionId,
    success: true,
  };
}

function createAnnotationQueuesSnapshotMessage(
  queues: IAnnotationQueuesSnapshotMessage["queues"],
): IAnnotationQueuesSnapshotMessage {
  return {
    queues,
    type: "snapshot",
  };
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

function createAnnotationQueueMutationErrorResponse(error: unknown): Response {
  if (error instanceof AnnotationQueueValidationError) {
    return new Response(error.message, { status: 400 });
  }

  if (error instanceof AnnotationQueueNotFoundError) {
    return new Response(error.message, { status: 404 });
  }

  if (error instanceof AnnotationQueueConflictError) {
    return new Response(error.message, { status: 409 });
  }

  const message: string = error instanceof Error ? error.message : String(error);

  return new Response(message, { status: 500 });
}

function readAnnotationQueueEntryId(pathname: string): string | null {
  const match: RegExpMatchArray | null = pathname.match(/^\/__devhost__\/annotation-queues\/([^/]+)$/);

  return match?.[1] ?? null;
}

function readAnnotationQueueResumeId(pathname: string): string | null {
  const match: RegExpMatchArray | null = pathname.match(/^\/__devhost__\/annotation-queues\/([^/]+)\/resume$/);

  return match?.[1] ?? null;
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
    (columnNumber === undefined ||
      (typeof columnNumber === "number" && Number.isInteger(columnNumber) && columnNumber > 0)) &&
    (componentName === undefined || typeof componentName === "string")
  );
}

function isStartTerminalSessionRequest(value: unknown): value is StartTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const requestKind: unknown = Reflect.get(value, "kind");
  const launcher: unknown = Reflect.get(value, "launcher");

  if (requestKind === "agent") {
    const annotation: unknown = Reflect.get(value, "annotation");
    const targetSessionId: unknown = Reflect.get(value, "targetSessionId");

    if (targetSessionId !== undefined && typeof targetSessionId !== "string") {
      return false;
    }

    return isAnnotationSubmitDetail(annotation);
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

function isUpdateAnnotationQueueEntryRequest(value: unknown): value is IUpdateAnnotationQueueEntryRequest {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "comment") === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.values(value).every((entry: unknown): boolean => typeof entry === "string");
}

function parseTerminalSessionClientMessage(messageText: string): TerminalSessionClientMessage | null {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(messageText);
  } catch {
    return null;
  }

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

type TerminalSessionShutdownCallback = (sessionId: string) => Promise<void>;

function scheduleIdleTerminalSessionShutdown(
  sessionId: string,
  session: ITerminalSessionState,
  terminalSessions: Map<string, ITerminalSessionState>,
  beforeShutdown?: TerminalSessionShutdownCallback,
): void {
  cancelIdleTerminalSessionShutdown(session);
  session.idleTimeoutId = setTimeout((): void => {
    void closeIdleTerminalSession(sessionId, terminalSessions, beforeShutdown);
  }, idleTerminalSessionTimeoutInMilliseconds);
}

async function closeIdleTerminalSession(
  sessionId: string,
  terminalSessions: Map<string, ITerminalSessionState>,
  beforeShutdown?: TerminalSessionShutdownCallback,
): Promise<void> {
  try {
    await beforeShutdown?.(sessionId);
  } finally {
    closeTerminalSession(sessionId, terminalSessions);
  }
}

const normalClosureCode: number = 1000;
