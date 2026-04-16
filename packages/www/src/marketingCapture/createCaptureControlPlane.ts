import { fileURLToPath } from "node:url";

import type { IAnnotationQueueSnapshot } from "@alexgorbatchev/devhost/src/devtools/features/annotationQueue/types";
import type {
  IAnnotationMarkerPayload,
  IAnnotationSourceLocation,
  IAnnotationSubmitDetail,
} from "@alexgorbatchev/devhost/src/devtools/features/annotationComposer/types";
import type {
  IActiveTerminalSessionSnapshot,
  IStartEditorTerminalSessionRequest,
  StartTerminalSessionRequest,
  TerminalSessionClientMessage,
} from "@alexgorbatchev/devhost/src/devtools/features/terminalSessions/types";
import {
  ANNOTATION_QUEUES_WEBSOCKET_PATH,
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
  HEALTH_WEBSOCKET_PATH,
  LOGS_WEBSOCKET_PATH,
  RESTART_SERVICE_PATH,
  TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_START_PATH,
  TERMINAL_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "@alexgorbatchev/devhost/src/devtools/shared/constants";
import type {
  HealthResponse,
  ServiceHealth,
  ServiceLogEntry,
  ServiceLogStream,
} from "@alexgorbatchev/devhost/src/devtools/shared/types";

import {
  readMarketingRecordingScenario,
  type MarketingRecordingScenarioId,
} from "../features/marketingRecording/marketingRecordingScenarios";

type CaptureChannel = "annotation-queues" | "health" | "logs" | "terminal";
type CaptureControlMessage = string | Buffer | ArrayBuffer | Uint8Array;
type CaptureSessionEntry = [string, ICaptureTerminalSessionState];
type TimerCallback = () => void;

interface ILogLine {
  line: string;
  serviceName: string;
  stream: ServiceLogStream;
}

interface IRestartServiceRequest {
  serviceName: string;
}

interface ICaptureScenarioState {
  annotationQueueSockets: Set<Bun.ServerWebSocket<ICaptureControlWebSocketData>>;
  annotationQueues: IAnnotationQueueSnapshot[];
  healthSockets: Set<Bun.ServerWebSocket<ICaptureControlWebSocketData>>;
  logEntries: ServiceLogEntry[];
  logsSockets: Set<Bun.ServerWebSocket<ICaptureControlWebSocketData>>;
  nextLogEntryId: number;
  nextSessionNumber: number;
  services: ServiceHealth[];
  terminalSessions: Map<string, ICaptureTerminalSessionState>;
  terminalSocketsBySessionId: Map<string, Set<Bun.ServerWebSocket<ICaptureControlWebSocketData>>>;
  timers: Set<ReturnType<typeof setTimeout>>;
}

interface ICaptureTerminalSessionState {
  request: StartTerminalSessionRequest;
  sessionId: string;
  snapshotData: string;
}

export interface ICaptureControlWebSocketData {
  channel: CaptureChannel;
  scenarioId: MarketingRecordingScenarioId;
  sessionId?: string;
}

const captureResetPathname: string = "/__capture__/reset";
const scenarioCookieName: string = "devhost-capture-scenario";
const mockProjectRootPath: string = "/Users/alex/development/projects/devhost/packages/www";
const mockRouteOrigin: string = "https://app.localhost";
const mockStackName: string = "www-marketing-capture";
const terminalEchoDelayMs: number = 120;
const xtermStylesheetFilePath: string = fileURLToPath(import.meta.resolve("@xterm/xterm/css/xterm.css"));
let xtermStylesheetTextPromise: Promise<string> | null = null;

export function createCaptureControlPlane() {
  const scenarioStates = new Map<MarketingRecordingScenarioId, ICaptureScenarioState>();

  return {
    createHttpResponse,
    handleWebSocketClose,
    handleWebSocketMessage,
    handleWebSocketOpen,
    readWebSocketUpgradeData,
  };

  async function createHttpResponse(request: Request): Promise<Response | null> {
    const requestUrl: URL = new URL(request.url);

    if (requestUrl.pathname === captureResetPathname) {
      if (request.method.toUpperCase() !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const scenario = readMarketingRecordingScenario(requestUrl.searchParams.get("scenario"));

      if (scenario === null) {
        return new Response("Invalid marketing capture scenario.", { status: 400 });
      }

      resetScenarioState(scenario.id);
      return new Response(null, { status: 204 });
    }

    if (requestUrl.pathname === XTERM_STYLESHEET_PATH) {
      return new Response(await readXtermStylesheetText(), {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/css; charset=utf-8",
        },
      });
    }

    if (requestUrl.pathname === TERMINAL_SESSION_START_PATH) {
      return await createTerminalSessionResponse(request);
    }

    if (requestUrl.pathname === RESTART_SERVICE_PATH) {
      return await createRestartServiceResponse(request);
    }

    return null;
  }

  function readWebSocketUpgradeData(request: Request): ICaptureControlWebSocketData | null | undefined {
    const requestUrl: URL = new URL(request.url);
    const scenarioId: MarketingRecordingScenarioId | null = readScenarioIdFromRequest(request);

    if (requestUrl.pathname === HEALTH_WEBSOCKET_PATH) {
      return scenarioId === null ? null : { channel: "health", scenarioId };
    }

    if (requestUrl.pathname === LOGS_WEBSOCKET_PATH) {
      return scenarioId === null ? null : { channel: "logs", scenarioId };
    }

    if (requestUrl.pathname === ANNOTATION_QUEUES_WEBSOCKET_PATH) {
      return scenarioId === null ? null : { channel: "annotation-queues", scenarioId };
    }

    if (requestUrl.pathname === TERMINAL_SESSION_WEBSOCKET_PATH) {
      return scenarioId === null
        ? null
        : {
            channel: "terminal",
            scenarioId,
            sessionId: requestUrl.searchParams.get(TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME) ?? undefined,
          };
    }

    return undefined;
  }

  function handleWebSocketOpen(websocket: Bun.ServerWebSocket<ICaptureControlWebSocketData>): void {
    const scenarioState: ICaptureScenarioState = readOrCreateScenarioState(websocket.data.scenarioId);

    switch (websocket.data.channel) {
      case "annotation-queues": {
        scenarioState.annotationQueueSockets.add(websocket);
        websocket.send(JSON.stringify({ queues: scenarioState.annotationQueues, type: "snapshot" }));
        return;
      }
      case "health": {
        scenarioState.healthSockets.add(websocket);
        websocket.send(JSON.stringify({ services: scenarioState.services } satisfies HealthResponse));
        return;
      }
      case "logs": {
        scenarioState.logsSockets.add(websocket);
        websocket.send(JSON.stringify({ entries: scenarioState.logEntries, type: "snapshot" }));
        return;
      }
      case "terminal": {
        const sessionId: string | undefined = websocket.data.sessionId;

        if (sessionId === undefined) {
          websocket.send(JSON.stringify({ message: "Missing terminal session id.", type: "error" }));
          return;
        }

        const session: ICaptureTerminalSessionState | undefined = scenarioState.terminalSessions.get(sessionId);

        if (session === undefined) {
          websocket.send(JSON.stringify({ message: "Terminal session is no longer available.", type: "error" }));
          return;
        }

        const terminalSockets: Set<Bun.ServerWebSocket<ICaptureControlWebSocketData>> =
          scenarioState.terminalSocketsBySessionId.get(sessionId) ??
          new Set<Bun.ServerWebSocket<ICaptureControlWebSocketData>>();

        terminalSockets.add(websocket);
        scenarioState.terminalSocketsBySessionId.set(sessionId, terminalSockets);
        websocket.send(JSON.stringify({ data: session.snapshotData, type: "snapshot" }));
      }
    }
  }

  function handleWebSocketMessage(
    websocket: Bun.ServerWebSocket<ICaptureControlWebSocketData>,
    message: CaptureControlMessage,
  ): void {
    if (websocket.data.channel !== "terminal" || typeof message !== "string") {
      return;
    }

    const clientMessage: unknown = parseJsonText(message);

    if (!isTerminalSessionClientMessage(clientMessage) || websocket.data.sessionId === undefined) {
      websocket.send(JSON.stringify({ message: "Invalid terminal message.", type: "error" }));
      return;
    }

    handleTerminalClientMessage(websocket.data.scenarioId, websocket.data.sessionId, clientMessage);
  }

  function handleWebSocketClose(websocket: Bun.ServerWebSocket<ICaptureControlWebSocketData>): void {
    const scenarioState: ICaptureScenarioState | undefined = scenarioStates.get(websocket.data.scenarioId);

    if (scenarioState === undefined) {
      return;
    }

    scenarioState.annotationQueueSockets.delete(websocket);
    scenarioState.healthSockets.delete(websocket);
    scenarioState.logsSockets.delete(websocket);

    if (websocket.data.channel === "terminal" && websocket.data.sessionId !== undefined) {
      const terminalSockets = scenarioState.terminalSocketsBySessionId.get(websocket.data.sessionId);

      terminalSockets?.delete(websocket);

      if (terminalSockets?.size === 0) {
        scenarioState.terminalSocketsBySessionId.delete(websocket.data.sessionId);
      }
    }
  }

  async function createRestartServiceResponse(request: Request): Promise<Response> {
    if (request.method.toUpperCase() !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const scenarioId: MarketingRecordingScenarioId | null = readScenarioIdFromRequest(request);

    if (scenarioId === null) {
      return new Response("Forbidden", { status: 403 });
    }

    const requestBody: unknown = await readRequestJson(request);

    if (!isRestartServiceRequest(requestBody)) {
      return new Response("Invalid restart service payload.", { status: 400 });
    }

    const scenarioState: ICaptureScenarioState = readOrCreateScenarioState(scenarioId);

    setServiceHealth(scenarioState, requestBody.serviceName, false);
    appendLogEntry(scenarioState, requestBody.serviceName, "Restart requested from the injected devtools.", "stderr");
    scheduleTimer(scenarioState, 1_000, () => {
      setServiceHealth(scenarioState, requestBody.serviceName, true);
      appendLogEntry(
        scenarioState,
        requestBody.serviceName,
        "Mock service recovered and passed its health check.",
        "stdout",
      );
    });

    return Response.json({ success: true });
  }

  async function createTerminalSessionResponse(request: Request): Promise<Response> {
    const scenarioId: MarketingRecordingScenarioId | null = readScenarioIdFromRequest(request);

    if (scenarioId === null) {
      return new Response("Forbidden", { status: 403 });
    }

    const scenarioState: ICaptureScenarioState = readOrCreateScenarioState(scenarioId);
    const requestMethod: string = request.method.toUpperCase();

    if (requestMethod === "GET") {
      return Response.json({
        sessions: [...scenarioState.terminalSessions.values()].map((session): IActiveTerminalSessionSnapshot => {
          return {
            request: session.request,
            sessionId: session.sessionId,
          };
        }),
      });
    }

    if (requestMethod !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const requestBody: unknown = await readRequestJson(request);

    if (!isStartTerminalSessionRequest(requestBody)) {
      return new Response("Invalid terminal session request.", { status: 400 });
    }

    const nextSessionId: string = `${requestBody.kind}-session-${scenarioState.nextSessionNumber}`;

    scenarioState.nextSessionNumber += 1;
    scenarioState.terminalSessions.set(nextSessionId, {
      request: requestBody,
      sessionId: nextSessionId,
      snapshotData: createTerminalSnapshotData(requestBody),
    });

    return Response.json({ sessionId: nextSessionId });
  }

  function appendLogEntry(
    scenarioState: ICaptureScenarioState,
    serviceName: string,
    line: string,
    stream: ServiceLogStream,
  ): void {
    const nextEntry: ServiceLogEntry = {
      id: scenarioState.nextLogEntryId,
      line,
      serviceName,
      stream,
    };

    scenarioState.nextLogEntryId += 1;
    scenarioState.logEntries.push(nextEntry);

    for (const websocket of scenarioState.logsSockets) {
      websocket.send(JSON.stringify({ entry: nextEntry, type: "entry" }));
    }
  }

  function broadcastHealth(scenarioState: ICaptureScenarioState): void {
    const healthResponse: HealthResponse = {
      services: scenarioState.services,
    };

    for (const websocket of scenarioState.healthSockets) {
      websocket.send(JSON.stringify(healthResponse));
    }
  }

  function disposeScenarioState(scenarioState: ICaptureScenarioState): void {
    for (const timer of scenarioState.timers) {
      clearTimeout(timer);
    }

    const sockets = new Set<Bun.ServerWebSocket<ICaptureControlWebSocketData>>([
      ...scenarioState.annotationQueueSockets,
      ...scenarioState.healthSockets,
      ...scenarioState.logsSockets,
    ]);

    for (const terminalSockets of scenarioState.terminalSocketsBySessionId.values()) {
      for (const websocket of terminalSockets) {
        sockets.add(websocket);
      }
    }

    for (const websocket of sockets) {
      try {
        websocket.close(1_000, "capture reset");
      } catch {
        continue;
      }
    }
  }

  function handleTerminalClientMessage(
    scenarioId: MarketingRecordingScenarioId,
    sessionId: string,
    message: TerminalSessionClientMessage,
  ): void {
    const scenarioState: ICaptureScenarioState = readOrCreateScenarioState(scenarioId);
    const terminalSession: ICaptureTerminalSessionState | undefined = scenarioState.terminalSessions.get(sessionId);

    if (terminalSession === undefined) {
      return;
    }

    if (message.type === "resize") {
      return;
    }

    if (message.type === "close") {
      const terminalSockets = scenarioState.terminalSocketsBySessionId.get(sessionId);

      if (terminalSockets !== undefined) {
        for (const websocket of terminalSockets) {
          websocket.send(JSON.stringify({ exitCode: 0, signalCode: null, type: "exit" }));
        }
      }

      return;
    }

    const echoedOutput: string = createTerminalEcho(message.data, terminalSession.request);

    terminalSession.snapshotData = `${terminalSession.snapshotData}${echoedOutput}`;

    scheduleTimer(scenarioState, terminalEchoDelayMs, () => {
      const terminalSockets = scenarioState.terminalSocketsBySessionId.get(sessionId);

      if (terminalSockets === undefined) {
        return;
      }

      for (const websocket of terminalSockets) {
        websocket.send(JSON.stringify({ data: echoedOutput, type: "output" }));
      }
    });
  }

  function readOrCreateScenarioState(scenarioId: MarketingRecordingScenarioId): ICaptureScenarioState {
    const existingState: ICaptureScenarioState | undefined = scenarioStates.get(scenarioId);

    if (existingState !== undefined) {
      return existingState;
    }

    const nextState: ICaptureScenarioState = createScenarioState(scenarioId);

    scenarioStates.set(scenarioId, nextState);
    return nextState;
  }

  function readScenarioIdFromRequest(request: Request): MarketingRecordingScenarioId | null {
    const requestUrl: URL = new URL(request.url);
    const queryToken: string | null = requestUrl.searchParams.get(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME);

    if (queryToken !== null) {
      return readScenarioId(queryToken);
    }

    const headerToken: string | null = request.headers.get(DEVTOOLS_CONTROL_TOKEN_HEADER_NAME);

    if (headerToken !== null) {
      return readScenarioId(headerToken);
    }

    const scenarioCookieValue: string | undefined = readCookieValue(request.headers.get("cookie"), scenarioCookieName);

    if (scenarioCookieValue !== undefined) {
      return readScenarioId(scenarioCookieValue);
    }

    const refererHeader: string | null = request.headers.get("referer");

    if (refererHeader !== null) {
      const refererUrl = parseUrl(refererHeader);

      if (refererUrl !== null) {
        return readScenarioId(refererUrl.searchParams.get("scenario"));
      }
    }

    return null;
  }

  function readScenarioId(value: string | null): MarketingRecordingScenarioId | null {
    return readMarketingRecordingScenario(value)?.id ?? null;
  }

  function resetScenarioState(scenarioId: MarketingRecordingScenarioId): void {
    const existingState: ICaptureScenarioState | undefined = scenarioStates.get(scenarioId);

    if (existingState !== undefined) {
      disposeScenarioState(existingState);
    }

    scenarioStates.set(scenarioId, createScenarioState(scenarioId));
  }

  function scheduleTimer(
    scenarioState: ICaptureScenarioState,
    delayMs: number,
    callback: TimerCallback,
  ): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      scenarioState.timers.delete(timer);
      callback();
    }, delayMs);

    scenarioState.timers.add(timer);
    return timer;
  }

  function setServiceHealth(scenarioState: ICaptureScenarioState, serviceName: string, status: boolean): void {
    scenarioState.services = scenarioState.services.map((service: ServiceHealth): ServiceHealth => {
      if (service.name !== serviceName) {
        return service;
      }

      return {
        ...service,
        status,
      };
    });
    broadcastHealth(scenarioState);
  }
}

function createScenarioState(scenarioId: MarketingRecordingScenarioId): ICaptureScenarioState {
  const initialTerminalSessions: IActiveTerminalSessionSnapshot[] =
    scenarioId === "sessions"
      ? [
          {
            request: createAgentSessionRequest(
              "Tighten the route-ready copy and keep the status rail readable while the app warms up.",
              "Capture dashboard",
              `${mockRouteOrigin}/dashboard`,
            ),
            sessionId: "pi-session",
          },
        ]
      : [];
  const logEntries: ServiceLogEntry[] = createLogEntriesForScenario(scenarioId);
  const nextLogEntryId: number = logEntries.at(-1)?.id ?? 0;
  const scenarioState: ICaptureScenarioState = {
    annotationQueueSockets: new Set(),
    annotationQueues: createAnnotationQueues(),
    healthSockets: new Set(),
    logEntries,
    logsSockets: new Set(),
    nextLogEntryId: nextLogEntryId + 1,
    nextSessionNumber: initialTerminalSessions.length + 1,
    services: createServicesForScenario(scenarioId),
    terminalSessions: new Map(
      initialTerminalSessions.map(
        (session): CaptureSessionEntry => [
          session.sessionId,
          {
            request: session.request,
            sessionId: session.sessionId,
            snapshotData: createTerminalSnapshotData(session.request),
          },
        ],
      ),
    ),
    terminalSocketsBySessionId: new Map(),
    timers: new Set(),
  };
  const scenario = readMarketingRecordingScenario(scenarioId);

  if (scenario?.routeRevealDelayMs !== undefined) {
    const timer = setTimeout((): void => {
      scenarioState.timers.delete(timer);
      scenarioState.services = scenarioState.services.map((service: ServiceHealth): ServiceHealth => {
        if (service.name !== "app") {
          return service;
        }

        return {
          ...service,
          status: true,
        };
      });

      const healthResponse: HealthResponse = { services: scenarioState.services };

      for (const websocket of scenarioState.healthSockets) {
        websocket.send(JSON.stringify(healthResponse));
      }

      appendScenarioLogEntry(
        scenarioState,
        "devhost",
        `Health gate passed for ${mockRouteOrigin}. Routing is now live.`,
        "stdout",
      );
      appendScenarioLogEntry(scenarioState, "app", "Route ready. Rendering the live dashboard shell.", "stdout");
    }, scenario.routeRevealDelayMs);

    scenarioState.timers.add(timer);
  }

  return scenarioState;
}

function appendScenarioLogEntry(
  scenarioState: ICaptureScenarioState,
  serviceName: string,
  line: string,
  stream: ServiceLogStream,
): void {
  const nextEntry: ServiceLogEntry = {
    id: scenarioState.nextLogEntryId,
    line,
    serviceName,
    stream,
  };

  scenarioState.nextLogEntryId += 1;
  scenarioState.logEntries.push(nextEntry);

  for (const websocket of scenarioState.logsSockets) {
    websocket.send(JSON.stringify({ entry: nextEntry, type: "entry" }));
  }
}

function createServicesForScenario(scenarioId: MarketingRecordingScenarioId): ServiceHealth[] {
  const primaryStatus: boolean = scenarioId === "routing-health" ? false : true;

  return [
    { name: "app", status: primaryStatus, url: `${mockRouteOrigin}/dashboard` },
    { name: "api", status: true, url: `${mockRouteOrigin}/api/healthz` },
    { name: "worker", status: true },
  ];
}

function createAnnotationQueues(): IAnnotationQueueSnapshot[] {
  return [
    {
      activeSessionId: null,
      entries: [
        {
          annotation: createAnnotationDetail(
            "Pin the rollout note under the health badge and keep the annotation markers visible in the summary.",
            "Capture dashboard",
            `${mockRouteOrigin}/dashboard`,
          ),
          createdAt: Date.UTC(2026, 3, 15, 10, 5, 0),
          entryId: "annotation-queue-entry-1",
          state: "paused-active",
          updatedAt: Date.UTC(2026, 3, 15, 10, 7, 0),
        },
        {
          annotation: createAnnotationDetail(
            "Follow up on the terminal tray spacing after the next route-health pass.",
            "Capture dashboard",
            `${mockRouteOrigin}/dashboard`,
          ),
          createdAt: Date.UTC(2026, 3, 15, 10, 8, 0),
          entryId: "annotation-queue-entry-2",
          state: "queued",
          updatedAt: Date.UTC(2026, 3, 15, 10, 8, 30),
        },
      ],
      pauseReason: "session-exited-before-finished",
      queueId: "capture-queue",
      status: "paused",
    },
  ];
}

function createAgentSessionRequest(comment: string, title: string, url: string): StartTerminalSessionRequest {
  return {
    annotation: createAnnotationDetail(comment, title, url),
    kind: "agent",
  };
}

function createAnnotationDetail(comment: string, title: string, url: string): IAnnotationSubmitDetail {
  return {
    comment,
    markers: [createAnnotationMarker(1, "Capture card", createSourceLocation("MarketingCapturePage", 192, 3))],
    stackName: mockStackName,
    submittedAt: Date.UTC(2026, 3, 15, 10, 0, 0),
    title,
    url,
  };
}

function createAnnotationMarker(
  markerNumber: number,
  elementName: string,
  sourceLocation?: IAnnotationSourceLocation,
): IAnnotationMarkerPayload {
  return {
    accessibility: `${elementName} button`,
    boundingBox: {
      height: 88,
      width: 240,
      x: 120,
      y: 240,
    },
    computedStyles: "display: grid; border-radius: 18px; background: rgba(15, 23, 42, 0.84);",
    computedStylesObj: {
      backgroundColor: "rgb(15, 23, 42)",
      borderRadius: "18px",
      display: "grid",
    },
    cssClasses: "capture-card capture-card--interactive",
    element: elementName,
    elementPath: `body > main > section > button:nth-child(${markerNumber})`,
    fullPath: `body > main > section > button:nth-child(${markerNumber})`,
    isFixed: false,
    markerNumber,
    nearbyElements: "Route badge, rollout note, health status",
    nearbyText: "Live route, health gate, annotation markers",
    selectedText: undefined,
    sourceLocation,
  };
}

function createSourceLocation(
  componentName: string,
  lineNumber: number,
  columnNumber: number,
): IAnnotationSourceLocation {
  return {
    columnNumber,
    componentName,
    fileName: `${mockProjectRootPath}/src/marketingCapture/MarketingCapturePage.tsx`,
    lineNumber,
  };
}

function createLogEntriesForScenario(scenarioId: MarketingRecordingScenarioId): ServiceLogEntry[] {
  const logLines: ILogLine[] = [
    {
      line:
        scenarioId === "routing-health"
          ? `[devhost] Holding ${mockRouteOrigin} behind the health gate.`
          : `[devhost] Routing ${mockRouteOrigin} through the managed local edge.`,
      serviceName: "devhost",
      stream: "stdout",
    },
    { line: "Booting the demo stack from devhost.toml", serviceName: "devhost", stream: "stdout" },
    { line: "Reading capture fixtures for the routed dashboard", serviceName: "app", stream: "stdout" },
    { line: "Connecting browser-side devtools transport", serviceName: "app", stream: "stdout" },
    { line: "Warming the annotations queue and terminal state", serviceName: "worker", stream: "stdout" },
    { line: "Health probe ready on /healthz", serviceName: "api", stream: "stdout" },
  ];

  for (let index = 0; index < 24; index += 1) {
    logLines.push({
      line: `Render pass ${index + 1} synced the host dashboard cards.`,
      serviceName: "app",
      stream: "stdout",
    });
    logLines.push({
      line: `Structured event ${index + 1} captured for the replay timeline.`,
      serviceName: "worker",
      stream: index % 4 === 0 ? "stderr" : "stdout",
    });
  }

  if (scenarioId === "routing-health") {
    logLines.push({
      line: "Waiting for app health to flip green before exposing the route.",
      serviceName: "devhost",
      stream: "stderr",
    });
  }

  return logLines.map((entry, index): ServiceLogEntry => {
    return {
      id: index + 1,
      line: entry.line,
      serviceName: entry.serviceName,
      stream: entry.stream,
    };
  });
}

function createTerminalSnapshotData(request: StartTerminalSessionRequest): string {
  if (request.kind === "editor") {
    return "\u001b[32m~ \u001b[34mNeovim is running...\u001b[0m\r\n:set relativenumber\r\n";
  }

  return "Agent Pi is ready.\r\n> review the capture dashboard\r\n";
}

function createTerminalEcho(input: string, request: StartTerminalSessionRequest): string {
  const normalizedInput: string = input.replaceAll("\n", "\r\n");

  if (!input.includes("\r")) {
    return normalizedInput;
  }

  return request.kind === "editor"
    ? `${normalizedInput}Mocked file change staged in the Neovim session.\r\n`
    : `${normalizedInput}Mocked agent queue accepted the follow-up note.\r\n`;
}

function isAnnotationSubmitDetail(value: unknown): value is IAnnotationSubmitDetail {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof Reflect.get(value, "comment") === "string" &&
    Array.isArray(Reflect.get(value, "markers")) &&
    typeof Reflect.get(value, "stackName") === "string" &&
    typeof Reflect.get(value, "submittedAt") === "number" &&
    typeof Reflect.get(value, "title") === "string" &&
    typeof Reflect.get(value, "url") === "string"
  );
}

function isEditorSessionRequest(value: unknown): value is IStartEditorTerminalSessionRequest {
  if (!isRecord(value)) {
    return false;
  }

  const source: unknown = Reflect.get(value, "source");

  return (
    Reflect.get(value, "kind") === "editor" &&
    Reflect.get(value, "launcher") === "neovim" &&
    typeof Reflect.get(value, "componentName") === "string" &&
    typeof Reflect.get(value, "sourceLabel") === "string" &&
    isSourceLocation(source)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRestartServiceRequest(value: unknown): value is IRestartServiceRequest {
  return isRecord(value) && typeof Reflect.get(value, "serviceName") === "string";
}

function isSourceLocation(value: unknown): value is IAnnotationSourceLocation {
  return (
    isRecord(value) &&
    typeof Reflect.get(value, "fileName") === "string" &&
    typeof Reflect.get(value, "lineNumber") === "number" &&
    (typeof Reflect.get(value, "columnNumber") === "number" || Reflect.get(value, "columnNumber") === undefined) &&
    (typeof Reflect.get(value, "componentName") === "string" || Reflect.get(value, "componentName") === undefined)
  );
}

function isStartTerminalSessionRequest(value: unknown): value is StartTerminalSessionRequest {
  if (!isRecord(value)) {
    return false;
  }

  if (Reflect.get(value, "kind") === "agent") {
    return isAnnotationSubmitDetail(Reflect.get(value, "annotation"));
  }

  return isEditorSessionRequest(value);
}

function isTerminalSessionClientMessage(value: unknown): value is TerminalSessionClientMessage {
  if (!isRecord(value)) {
    return false;
  }

  const type: unknown = Reflect.get(value, "type");

  if (type === "input") {
    return typeof Reflect.get(value, "data") === "string";
  }

  if (type === "resize") {
    return typeof Reflect.get(value, "cols") === "number" && typeof Reflect.get(value, "rows") === "number";
  }

  return type === "close";
}

function parseJsonText(text: string): unknown {
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseUrl(urlText: string): URL | null {
  try {
    return new URL(urlText);
  } catch {
    return null;
  }
}

function readCookieValue(cookieHeader: string | null, cookieName: string): string | undefined {
  if (cookieHeader === null) {
    return undefined;
  }

  for (const cookiePart of cookieHeader.split(";")) {
    const [namePart, ...valueParts] = cookiePart.trim().split("=");

    if (namePart === cookieName) {
      return valueParts.join("=");
    }
  }

  return undefined;
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function readXtermStylesheetText(): Promise<string> {
  if (xtermStylesheetTextPromise === null) {
    xtermStylesheetTextPromise = Bun.file(xtermStylesheetFilePath).text();
  }

  return await xtermStylesheetTextPromise;
}
