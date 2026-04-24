import { renderDevtools } from "@alexgorbatchev/devhost-ui";

import { createRrwebDemoRecording } from "../recordings/createRrwebDemoRecording";
import {
  readMarketingRecordingScenario,
  type IMarketingRecordingScenario,
  type MarketingRecordingScenarioId,
} from "../recordings/marketingRecordingScenarios";
import type { IRrwebDemoRecording, IRrwebDemoRecordingController } from "../recordings/types";

type FetchRequestInput = Parameters<typeof fetch>[0];
type FetchRequestInit = Parameters<typeof fetch>[1];
type MockWebSocketUrl = string | URL;
type Cleanup = () => void;

const captureSourceCardReadySelector =
  '[data-testid="CaptureSourceContent--source-card"][data-capture-source-card-ready="true"]';

interface IDevtoolsHook {
  isOpen(): boolean;
  render(): void;
  setIsOpen(): void;
}

interface ISourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

interface IRoutedService {
  host: string;
  path: string;
  serviceName: string;
}

interface IInjectedCaptureConfig {
  agentDisplayName: string;
  annotationEnabled: boolean;
  annotationQueueEnabled: boolean;
  componentEditor: string;
  controlToken: string;
  editorEnabled: boolean;
  externalToolbarsEnabled: boolean;
  minimapEnabled: boolean;
  position: string;
  projectRootPath: string;
  routedServices: IRoutedService[];
  stackName: string;
  statusEnabled: boolean;
  terminalEnabled: boolean;
}

interface IAnnotationDetail {
  comment: string;
  markers: unknown[];
  stackName: string;
  submittedAt: number;
  title: string;
  url: string;
}

interface IAgentTerminalSessionRequest {
  annotation: IAnnotationDetail;
  kind: "agent";
  targetSessionId?: string;
}

interface IEditorTerminalSessionRequest {
  componentName: string;
  kind: "editor";
  launcher: string;
  source: ISourceLocation;
  sourceLabel: string;
}

type TerminalSessionRequest = IAgentTerminalSessionRequest | IEditorTerminalSessionRequest;

interface IActiveTerminalSessionSnapshot {
  request: TerminalSessionRequest;
  sessionId: string;
}

interface ITerminalSessionStore {
  createSession(request: TerminalSessionRequest): IActiveTerminalSessionSnapshot;
  listSessions(): IActiveTerminalSessionSnapshot[];
}

interface IMarketingCaptureApi {
  isReady(): boolean;
  readScenarioId(): MarketingRecordingScenarioId | null;
  startRecording(): boolean;
  stopRecording(): IRrwebDemoRecording | null;
}

type IsReadyReader = () => boolean;

interface IRecordingControllerState {
  readRecordingController(): IRrwebDemoRecordingController | null;
  setRecordingController(controller: IRrwebDemoRecordingController | null): void;
}

interface IDevhostCaptureMockOptions {
  hostName: string;
  projectRootPath: string;
  scenario: IMarketingRecordingScenario | null;
  stackName: string;
}

interface IRouteStatusElements {
  routeStatusButton: HTMLButtonElement | null;
  routeStatusText: HTMLElement | null;
}

declare global {
  interface Window {
    __DEVHOST_INJECTED_CONFIG__?: IInjectedCaptureConfig;
    __DEVHOST_MARKETING_CAPTURE__?: IMarketingCaptureApi;
    __REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__?: IDevtoolsHook;
    __ROUTER_DEVTOOLS_GLOBAL_HOOK__?: IDevtoolsHook;
  }
}

class DevhostCaptureDemoElement extends HTMLElement {
  #cleanup: Cleanup | null = null;

  connectedCallback(): void {
    if (this.#cleanup !== null) {
      return;
    }

    const hostName: string = window.location.hostname;
    const projectRootPath: string = this.dataset.projectRootPath ?? "/capture-demo";
    const stackName: string = this.dataset.stackName ?? "www-marketing-capture";
    const scenario: IMarketingRecordingScenario | null = readRequestedMarketingCaptureScenario();

    this.#cleanup = installDevhostCaptureMocks({ hostName, projectRootPath, scenario, stackName });
    renderDevtools();
  }

  disconnectedCallback(): void {
    this.#cleanup?.();
    this.#cleanup = null;
  }
}

if (!customElements.get("devhost-capture-demo")) {
  customElements.define("devhost-capture-demo", DevhostCaptureDemoElement);
}

function installDevhostCaptureMocks(options: IDevhostCaptureMockOptions): Cleanup {
  const originalWebSocket: typeof WebSocket = window.WebSocket;
  const originalFetch: typeof fetch = window.fetch;
  const sessionStore: ITerminalSessionStore = createTerminalSessionStore(options);
  const routeStatusCleanup: Cleanup = configureRouteStatus(options.scenario);
  let isReady: boolean = false;
  let recordingController: IRrwebDemoRecordingController | null = null;

  window.__DEVHOST_INJECTED_CONFIG__ = createInjectedConfig(options);
  window.__DEVHOST_MARKETING_CAPTURE__ = createMarketingCaptureApi((): boolean => isReady, options, {
    readRecordingController: (): IRrwebDemoRecordingController | null => recordingController,
    setRecordingController: (controller: IRrwebDemoRecordingController | null): void => {
      recordingController = controller;
    },
  });
  window.__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__ = createNoopDevtoolsHook();
  window.__ROUTER_DEVTOOLS_GLOBAL_HOOK__ = createNoopDevtoolsHook();

  const markReady = (): void => {
    isReady = true;
  };

  window.addEventListener("devhost-capture-source-card-ready", markReady, { once: true });

  if (document.querySelector(captureSourceCardReadySelector) !== null) {
    markReady();
  }

  Reflect.set(window, "WebSocket", createMockWebSocketClass(options, sessionStore));

  const mockFetch = async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
    const requestUrl: string = readRequestUrl(input);
    const requestMethod: string = readRequestMethod(input, init);

    if (requestUrl.includes("/terminal-sessions")) {
      return await handleTerminalSessionsRequest(input, init, requestMethod, sessionStore);
    }

    if (requestUrl.includes("/annotation-queues/")) {
      return handleAnnotationQueuesMutationRequest(requestMethod, sessionStore, options);
    }

    if (requestUrl.includes("/restart-service")) {
      return new Response(null, { status: 204 });
    }

    return originalFetch.call(window, input, init);
  };

  Reflect.set(window, "fetch", mockFetch);

  return (): void => {
    routeStatusCleanup();
    window.removeEventListener("devhost-capture-source-card-ready", markReady);
    Reflect.deleteProperty(window, "__DEVHOST_INJECTED_CONFIG__");
    Reflect.deleteProperty(window, "__DEVHOST_MARKETING_CAPTURE__");
    Reflect.deleteProperty(window, "__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__");
    Reflect.deleteProperty(window, "__ROUTER_DEVTOOLS_GLOBAL_HOOK__");
    Reflect.set(window, "WebSocket", originalWebSocket);
    Reflect.set(window, "fetch", originalFetch);
  };
}

function createMarketingCaptureApi(
  readIsReady: IsReadyReader,
  options: IDevhostCaptureMockOptions,
  controllerState: IRecordingControllerState,
): IMarketingCaptureApi {
  return {
    isReady(): boolean {
      return readIsReady();
    },
    readScenarioId(): MarketingRecordingScenarioId | null {
      return options.scenario?.id ?? null;
    },
    startRecording(): boolean {
      if (controllerState.readRecordingController() !== null) {
        return false;
      }

      controllerState.setRecordingController(createRrwebDemoRecording());
      return true;
    },
    stopRecording(): IRrwebDemoRecording | null {
      const recordingController: IRrwebDemoRecordingController | null = controllerState.readRecordingController();

      if (recordingController === null) {
        return null;
      }

      controllerState.setRecordingController(null);
      return recordingController.stop();
    },
  };
}

function createInjectedConfig(options: IDevhostCaptureMockOptions): IInjectedCaptureConfig {
  return {
    agentDisplayName: "Pi",
    annotationEnabled: true,
    annotationQueueEnabled: true,
    componentEditor: "neovim",
    controlToken: options.scenario?.id ?? "capture-demo",
    editorEnabled: true,
    externalToolbarsEnabled: false,
    minimapEnabled: true,
    position: "top-right",
    projectRootPath: options.projectRootPath,
    routedServices: [
      { host: options.hostName, path: "/", serviceName: "app" },
      { host: options.hostName, path: "/api", serviceName: "api" },
      { host: `worker.${options.hostName}`, path: "/", serviceName: "worker" },
    ],
    stackName: options.stackName,
    statusEnabled: true,
    terminalEnabled: true,
  };
}

function createNoopDevtoolsHook(): IDevtoolsHook {
  return {
    isOpen: (): boolean => false,
    render: (): void => {},
    setIsOpen: (): void => {},
  };
}

function createTerminalSessionStore(options: IDevhostCaptureMockOptions): ITerminalSessionStore {
  let sessionCounter: number = 2;
  const sessions: IActiveTerminalSessionSnapshot[] = [
    {
      request: {
        annotation: {
          comment: "Update the header title",
          markers: [],
          stackName: options.stackName,
          submittedAt: Date.now(),
          title: "MarketingCapturePage",
          url: window.location.href,
        },
        kind: "agent",
      },
      sessionId: "capture-agent-session-1",
    },
    {
      request: {
        componentName: "CaptureSourceCardSurface",
        kind: "editor",
        launcher: "neovim",
        source: createCaptureSourceLocation(),
        sourceLabel: "src/components/CaptureSourceCardSurface.tsx:1:1",
      },
      sessionId: "capture-editor-session-1",
    },
  ];

  return {
    createSession(request: TerminalSessionRequest): IActiveTerminalSessionSnapshot {
      const sessionId: string =
        request.kind === "editor"
          ? `capture-editor-session-${sessionCounter}`
          : `capture-agent-session-${sessionCounter}`;
      const session: IActiveTerminalSessionSnapshot = { request, sessionId };

      sessionCounter += 1;
      sessions.push(session);
      return session;
    },
    listSessions(): IActiveTerminalSessionSnapshot[] {
      return [...sessions];
    },
  };
}

function configureRouteStatus(scenario: IMarketingRecordingScenario | null): Cleanup {
  const { routeStatusButton, routeStatusText }: IRouteStatusElements = readRouteStatusElements();

  if (routeStatusButton === null || routeStatusText === null) {
    return (): void => {};
  }

  let revealTimer: number | null = null;

  const applyLiveRouteState = (): void => {
    routeStatusButton.disabled = false;
    routeStatusText.textContent = "The managed route is now live and both routed services are healthy.";
  };

  if (scenario?.routeRevealDelayMs !== undefined) {
    routeStatusButton.disabled = true;
    revealTimer = window.setTimeout((): void => {
      applyLiveRouteState();
    }, scenario.routeRevealDelayMs);
  } else {
    applyLiveRouteState();
  }

  const handleClick = (): void => {
    routeStatusText.textContent =
      "The live route reveal is active. The capture can now showcase the final routing state.";
  };

  routeStatusButton.addEventListener("click", handleClick);

  return (): void => {
    if (revealTimer !== null) {
      window.clearTimeout(revealTimer);
    }

    routeStatusButton.removeEventListener("click", handleClick);
  };
}

function readRouteStatusElements(): IRouteStatusElements {
  return {
    routeStatusButton: document.querySelector('[data-testid="MarketingCapturePage--route-live-button"]'),
    routeStatusText: document.querySelector("[data-capture-route-status-text]"),
  };
}

async function handleTerminalSessionsRequest(
  input: FetchRequestInput,
  init: FetchRequestInit | undefined,
  requestMethod: string,
  sessionStore: ITerminalSessionStore,
): Promise<Response> {
  if (requestMethod === "GET") {
    return new Response(JSON.stringify({ sessions: sessionStore.listSessions() }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (requestMethod === "POST") {
    const requestBody: string = (await readRequestBodyText(input, init)) ?? "";
    const request: TerminalSessionRequest | null = readTerminalSessionRequest(requestBody);

    if (request === null) {
      return new Response("Invalid terminal session request.", { status: 400 });
    }

    const session = sessionStore.createSession(request);

    return new Response(JSON.stringify({ sessionId: session.sessionId }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Unsupported terminal session method.", { status: 405 });
}

function handleAnnotationQueuesMutationRequest(
  requestMethod: string,
  sessionStore: ITerminalSessionStore,
  options: IDevhostCaptureMockOptions,
): Response {
  if (requestMethod === "POST") {
    const resumedSession = sessionStore.createSession({
      annotation: {
        comment: "Resume the paused capture handoff queue.",
        markers: [],
        stackName: options.stackName,
        submittedAt: Date.now(),
        title: "MarketingCapturePage",
        url: window.location.href,
      },
      kind: "agent",
    });

    return new Response(JSON.stringify({ sessionId: resumedSession.sessionId, success: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (requestMethod === "PATCH" || requestMethod === "DELETE") {
    return new Response(null, { status: 204 });
  }

  return new Response("Unsupported annotation queue method.", { status: 405 });
}

function createMockWebSocketClass(options: IDevhostCaptureMockOptions, sessionStore: ITerminalSessionStore) {
  return class MockWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    binaryType: BinaryType = "blob";
    bufferedAmount: number = 0;
    extensions: string = "";
    protocol: string = "";
    readyState: number = MockWebSocket.CONNECTING;

    constructor(url: MockWebSocketUrl) {
      super();
      this.url = String(url);

      setTimeout((): void => {
        this.openConnection();
      }, 50);
    }

    close(code: number = 1000, reason: string = ""): void {
      if (this.readyState === MockWebSocket.CLOSING || this.readyState === MockWebSocket.CLOSED) {
        return;
      }

      this.readyState = MockWebSocket.CLOSING;

      setTimeout((): void => {
        this.readyState = MockWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }, 50);
    }

    send(): void {}

    private emitMessage(payload: object): void {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
    }

    private emitSnapshotMessages(): void {
      const requestUrl: URL = new URL(this.url, window.location.href);

      if (requestUrl.pathname.includes("/ws/health")) {
        this.emitMessage({
          services: [
            { managed: true, name: "app", status: true },
            { managed: true, name: "api", status: true },
            { managed: false, name: "worker", status: false },
          ],
        });
        return;
      }

      if (requestUrl.pathname.includes("/ws/logs")) {
        this.emitMessage({
          entries: [
            { id: 1, line: "Listening on https://app.localhost", serviceName: "app", stream: "stdout" },
            { id: 2, line: "API listening on port 4000", serviceName: "api", stream: "stdout" },
            { id: 3, line: "Worker failed to start", serviceName: "worker", stream: "stderr" },
          ],
          type: "snapshot",
        });
        return;
      }

      if (requestUrl.pathname.includes("/ws/annotation-queues")) {
        this.emitMessage({
          queues: [
            {
              activeSessionId: null,
              entries: [
                {
                  annotation: {
                    comment: "Change the primary button color to blue.",
                    markers: [],
                    stackName: options.stackName,
                    submittedAt: Date.now() - 50_000,
                    title: "MarketingCapturePage",
                    url: window.location.href,
                  },
                  createdAt: Date.now() - 50_000,
                  entryId: "annotation-primary-button",
                  state: "paused-active",
                  updatedAt: Date.now() - 10_000,
                },
                {
                  annotation: {
                    comment: "Investigate the worker routing warning banner.",
                    markers: [],
                    stackName: options.stackName,
                    submittedAt: Date.now() - 32_000,
                    title: "MarketingCapturePage",
                    url: window.location.href,
                  },
                  createdAt: Date.now() - 32_000,
                  entryId: "routing-warning-banner",
                  state: "queued",
                  updatedAt: Date.now() - 32_000,
                },
              ],
              pauseReason: "session-exited-before-finished",
              queueId: "capture-demo-queue",
              status: "paused",
            },
          ],
          type: "snapshot",
        });
        return;
      }

      if (requestUrl.pathname.includes("/ws/terminal")) {
        const sessionId: string | null = requestUrl.searchParams.get("sessionId");
        const session = sessionStore.listSessions().find((activeSession: IActiveTerminalSessionSnapshot): boolean => {
          return activeSession.sessionId === sessionId;
        });

        if (session?.request.kind === "editor") {
          this.emitMessage({
            data: "\u001b[32m~ Devhost demo editor session is ready.\u001b[0m\r\n",
            type: "snapshot",
          });
          return;
        }

        this.emitMessage({ data: "MOCKED Agent Pi is ready.\r\n", type: "snapshot" });
      }
    }

    private openConnection(): void {
      if (this.readyState !== MockWebSocket.CONNECTING) {
        return;
      }

      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
      this.emitSnapshotMessages();
    }
  };
}

function createCaptureSourceLocation(): ISourceLocation {
  return {
    columnNumber: 1,
    componentName: "CaptureSourceCardSurface",
    fileName: "/src/components/CaptureSourceCardSurface.tsx",
    lineNumber: 1,
  };
}

function readRequestedMarketingCaptureScenario(): IMarketingRecordingScenario | null {
  const requestUrl: URL = new URL(window.location.href);
  return readMarketingRecordingScenario(requestUrl.searchParams.get("scenario"));
}

async function readRequestBodyText(input: FetchRequestInput, init?: FetchRequestInit): Promise<string | null> {
  if (init?.body !== undefined) {
    return typeof init.body === "string" ? init.body : String(init.body);
  }

  if (typeof input === "string" || input instanceof URL) {
    return null;
  }

  return await input.clone().text();
}

function readRequestUrl(input: FetchRequestInput): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function readRequestMethod(input: FetchRequestInput, init?: FetchRequestInit): string {
  if (typeof init?.method === "string") {
    return init.method.toUpperCase();
  }

  if (typeof input === "string" || input instanceof URL) {
    return "GET";
  }

  return input.method.toUpperCase();
}

function readTerminalSessionRequest(requestBody: string): TerminalSessionRequest | null {
  try {
    const value: unknown = JSON.parse(requestBody);

    if (isAgentTerminalSessionRequest(value)) {
      return value;
    }

    if (isEditorTerminalSessionRequest(value)) {
      return value;
    }

    return null;
  } catch {
    return null;
  }
}

function isAgentTerminalSessionRequest(value: unknown): value is IAgentTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const annotation: unknown = Reflect.get(value, "annotation");

  return Reflect.get(value, "kind") === "agent" && isAnnotationDetail(annotation);
}

function isEditorTerminalSessionRequest(value: unknown): value is IEditorTerminalSessionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    Reflect.get(value, "kind") === "editor" &&
    typeof Reflect.get(value, "componentName") === "string" &&
    typeof Reflect.get(value, "launcher") === "string" &&
    isSourceLocation(Reflect.get(value, "source")) &&
    typeof Reflect.get(value, "sourceLabel") === "string"
  );
}

function isAnnotationDetail(value: unknown): value is IAnnotationDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "comment") === "string" &&
    Array.isArray(Reflect.get(value, "markers")) &&
    typeof Reflect.get(value, "stackName") === "string" &&
    typeof Reflect.get(value, "submittedAt") === "number" &&
    typeof Reflect.get(value, "title") === "string" &&
    typeof Reflect.get(value, "url") === "string"
  );
}

function isSourceLocation(value: unknown): value is ISourceLocation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const columnNumber: unknown = Reflect.get(value, "columnNumber");
  const componentName: unknown = Reflect.get(value, "componentName");

  return (
    typeof Reflect.get(value, "fileName") === "string" &&
    typeof Reflect.get(value, "lineNumber") === "number" &&
    (columnNumber === undefined || typeof columnNumber === "number") &&
    (componentName === undefined || typeof componentName === "string")
  );
}
