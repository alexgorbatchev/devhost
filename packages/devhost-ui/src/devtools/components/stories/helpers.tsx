import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { JSX, ComponentType } from "react";
import type { StoryContext } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { App as DevtoolsApp } from "../App";
import {
  clearReactHighlightOverlays,
  highlightReactElements,
} from "../../features/reactHighlight/reactHighlightOverlay";
import {
  devtoolsStoryShadowRootHostTestId,
  readDevtoolsStoryShadowCanvas,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../shared/components/stories/helpers";
import type { IInjectedDevtoolsConfig } from "../../shared/readInjectedDevtoolsConfig";
import type { ServiceHealth, WorktreeRepository } from "../../shared/types";
import { readInjectedDevtoolsConfig } from "../../shared/readInjectedDevtoolsConfig";
import { factory_worktreeRepository } from "../../features/serviceStatusPanel/components/stories/fixtures";

declare global {
  interface Window {
    __DEVHOST_INJECTED_CONFIG__?: IInjectedDevtoolsConfig;
    __REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__?: unknown;
    __ROUTER_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  }
}

interface IDevhostMockDecoratorProps {
  Story: ComponentType;
}

type MockWebSocketUrl = string | URL;
type FetchRequestInput = Parameters<typeof fetch>[0];
type FetchRequestInit = Parameters<typeof fetch>[1];

export function withDevhostMock(Story: ComponentType, context: StoryContext): JSX.Element {
  if (context.parameters.worktreeRecovery === true) {
    return <ServiceRecoveryMockDecorator Story={Story} hasWorktreeFailure />;
  }
  if (context.parameters.serviceRecovery === true) {
    return <ServiceRecoveryMockDecorator Story={Story} />;
  }
  return <DevhostMockDecorator Story={Story} />;
}

interface IServiceRecoveryMockDecoratorProps extends IDevhostMockDecoratorProps {
  hasWorktreeFailure?: boolean;
}

function ServiceRecoveryMockDecorator({
  Story,
  hasWorktreeFailure = false,
}: IServiceRecoveryMockDecoratorProps): JSX.Element | null {
  const [isReady, setIsReady] = useState(false);
  const crashReference = useRef<() => void>(() => {});

  useEffect(() => {
    const originalWebSocket = window.WebSocket;
    const originalFetch = window.fetch;
    const originalConfig = window.__DEVHOST_INJECTED_CONFIG__;
    window.__DEVHOST_INJECTED_CONFIG__ = {
      ...readInjectedDevtoolsConfig(),
      annotationEnabled: false,
      annotationQueueEnabled: false,
      editorEnabled: false,
      externalToolbarsEnabled: false,
      minimapEnabled: false,
      terminalEnabled: false,
      statusEnabled: true,
    };
    let services: ServiceHealth[] = [{ managed: true, name: "api", status: true }];
    let repositories: WorktreeRepository[] = [];
    if (hasWorktreeFailure) {
      services = [{ managed: true, name: "api", status: false, exitCode: 7 }];
      repositories = [
        {
          ...factory_worktreeRepository(["api"]),
          selectedPath: "/worktrees/cart",
          runningPath: "",
          error: "Service api failed to start.",
        },
      ];
    }
    let shouldFailRestart = true;
    const sockets: RecoveryWebSocket[] = [];

    class RecoveryWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = RecoveryWebSocket.CONNECTING;
      readonly url: string;
      constructor(url: MockWebSocketUrl) {
        super();
        this.url = String(url);
        sockets.push(this);
        queueMicrotask(() => {
          if (this.readyState !== RecoveryWebSocket.CONNECTING) return;
          this.readyState = RecoveryWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          if (this.url.includes("/ws/health")) this.emit({ services, repositories });
          if (this.url.includes("/ws/logs"))
            this.emit({
              type: "snapshot",
              entries: [{ id: 1, serviceName: "api", stream: "stdout", line: "[api] ready" }],
            });
        });
      }
      close(): void {
        this.readyState = RecoveryWebSocket.CLOSED;
      }
      emit(value: unknown): void {
        if (this.readyState === RecoveryWebSocket.OPEN) {
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
        }
      }
    }
    const publishHealth = (): void => {
      sockets
        .filter((socket) => socket.url.includes("/ws/health"))
        .forEach((socket) => socket.emit({ services, repositories }));
    };
    crashReference.current = () => {
      services = [{ managed: true, name: "api", status: false, exitCode: 7 }];
      sockets
        .filter((socket) => socket.url.includes("/ws/logs"))
        .forEach((socket) =>
          socket.emit({
            type: "entry",
            entry: { id: 2, serviceName: "api", stream: "stderr", line: "[api] fatal error" },
          }),
        );
      publishHealth();
    };
    Reflect.set(window, "WebSocket", RecoveryWebSocket);
    window.fetch = Object.assign(
      async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
        if (String(input).endsWith("/worktrees")) {
          if (init?.method === "POST") {
            if (init.body !== '{"repositoryId":"shop","path":"/projects/shop"}')
              return new Response("Invalid selection", { status: 400 });
            repositories = repositories.map((repository) => ({
              ...repository,
              selectedPath: "/projects/shop",
              runningPath: "/projects/shop",
              error: undefined,
            }));
            services = [{ managed: true, name: "api", status: true }];
            publishHealth();
            return new Response(null, { status: 204 });
          }
          return Response.json({ services, repositories });
        }
        if (String(input).includes("/restart-service")) {
          if (init?.body !== '{"serviceNames":["api"]}') {
            return new Response("Invalid restart request", { status: 400 });
          }
          services = [{ managed: true, name: "api", status: false, exitCode: 7, restarting: true }];
          publishHealth();
          if (shouldFailRestart) {
            shouldFailRestart = false;
            services = [{ managed: true, name: "api", status: false, exitCode: 1 }];
            publishHealth();
            return new Response("Service api exited before passing its health check with code 1.", { status: 500 });
          }
          services = [{ managed: true, name: "api", status: true }];
          publishHealth();
          return new Response(null, { status: 204 });
        }
        return originalFetch(input, init);
      },
      { preconnect: originalFetch.preconnect },
    );
    setIsReady(true);
    return () => {
      Reflect.set(window, "WebSocket", originalWebSocket);
      window.fetch = originalFetch;
      window.__DEVHOST_INJECTED_CONFIG__ = originalConfig;
    };
  }, [hasWorktreeFailure]);

  return isReady ? (
    <>
      <button type="button" hidden={hasWorktreeFailure} onClick={() => crashReference.current()}>
        Crash api
      </button>
      <Story />
    </>
  ) : null;
}

function DevhostMockDecorator({ Story }: IDevhostMockDecoratorProps): JSX.Element {
  const isSetup = useRef<boolean>(false);

  useEffect(() => {
    if (isSetup.current) {
      return;
    }

    isSetup.current = true;

    window.__DEVHOST_INJECTED_CONFIG__ = {
      annotationActions: [{ displayName: "Pi", id: "agent", kind: "agent", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "vscode",
      homeDirectoryPath: "/home/alex",
      position: "bottom-right",
      projectRootPath: "/storybook-workspace",
      stackName: "storybook-stack",
      annotationEnabled: true,
      annotationQueueEnabled: true,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      statusEnabled: true,
      terminalEnabled: true,
      routedServices: [
        { host: window.location.hostname, path: "/", serviceName: "app" },
        { host: window.location.hostname, path: "/api", serviceName: "api" },
        { host: "worker." + window.location.hostname, path: "/", serviceName: "worker" },
      ],
    };

    const originalWebSocket = window.WebSocket;
    const originalFetch = window.fetch;

    class MockWebSocket extends EventTarget {
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
        }, 100);
      }

      close(code: number = 1000, reason: string = ""): void {
        if (this.readyState === MockWebSocket.CLOSING || this.readyState === MockWebSocket.CLOSED) {
          return;
        }

        this.readyState = MockWebSocket.CLOSING;

        setTimeout((): void => {
          this.readyState = MockWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent("close", { code, reason }));
        }, 100);
      }

      send(): void {}

      private emitMessage(data: string): void {
        this.dispatchEvent(new MessageEvent("message", { data }));
      }

      private emitSnapshotMessages(): void {
        const requestUrl = new URL(this.url, window.location.href);

        if (requestUrl.pathname.includes("/ws/health")) {
          this.emitMessage(
            JSON.stringify({
              services: [
                { managed: true, name: "app", status: true },
                { managed: true, name: "api", status: true },
                { managed: false, name: "worker", status: false },
              ],
            }),
          );
        } else if (requestUrl.pathname.includes("/ws/logs")) {
          this.emitMessage(
            JSON.stringify({
              type: "snapshot",
              entries: [
                { id: 1, line: "Listening on http://app.localhost", serviceName: "app", stream: "stdout" },
                { id: 2, line: "Starting API server...", serviceName: "api", stream: "stdout" },
                { id: 3, line: "API listening on port 4000", serviceName: "api", stream: "stdout" },
                { id: 4, line: "Worker failed to start", serviceName: "worker", stream: "stderr" },
              ],
            }),
          );
        } else if (requestUrl.pathname.includes("/ws/annotation-queues")) {
          this.emitMessage(
            JSON.stringify({
              type: "snapshot",
              queues: [
                {
                  activeSessionId: null,
                  queueId: "q1",
                  status: "paused",
                  pauseReason: "session-exited-before-finished",
                  entries: [
                    {
                      actionId: "agent",
                      entryId: "e1",
                      state: "paused-active",
                      createdAt: Date.now() - 50000,
                      updatedAt: Date.now() - 10000,
                      annotation: {
                        comment: "Change the primary button color to blue.",
                        markers: [],
                        stackName: "storybook-stack",
                        submittedAt: Date.now() - 50000,
                        title: "App.tsx",
                        url: "http://app.localhost/",
                      },
                    },
                    {
                      actionId: "agent",
                      entryId: "e2",
                      state: "queued",
                      createdAt: Date.now() - 40000,
                      updatedAt: Date.now() - 40000,
                      annotation: {
                        comment: "Fix layout overlap on mobile screens",
                        markers: [],
                        stackName: "storybook-stack",
                        submittedAt: Date.now() - 40000,
                        title: "MobileLayout.tsx",
                        url: "http://app.localhost/",
                      },
                    },
                    {
                      actionId: "agent",
                      entryId: "e3",
                      state: "queued",
                      createdAt: Date.now() - 30000,
                      updatedAt: Date.now() - 30000,
                      annotation: {
                        comment: "Add missing error handling",
                        markers: [],
                        stackName: "storybook-stack",
                        submittedAt: Date.now() - 30000,
                        title: "api.ts",
                        url: "http://api.app.localhost/",
                      },
                    },
                  ],
                },
              ],
            }),
          );
        } else if (requestUrl.pathname.includes("/ws/terminal")) {
          const sessionId: string | null = requestUrl.searchParams.get("sessionId");

          if (sessionId === "nvim-session") {
            this.emitMessage(
              JSON.stringify({
                data: "\u001b[32m~ \u001b[34mMOCKED Neovim is running...\u001b[0m\r\n",
                type: "snapshot",
              }),
            );
          } else {
            this.emitMessage(JSON.stringify({ data: "MOCKED Agent Pi is ready.\r\n", type: "snapshot" }));
          }
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
    }

    Reflect.set(window, "WebSocket", MockWebSocket);

    window.fetch = (async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
      const url: string =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

      if (url.includes("/terminal-sessions")) {
        return new Response(
          JSON.stringify({
            sessions: [
              {
                sessionId: "pi-session",
                request: {
                  actionId: "agent",
                  displayName: "Pi",
                  kind: "agent",
                  annotation: {
                    comment: "Update the header title",
                    markers: [],
                    stackName: "storybook-stack",
                    submittedAt: Date.now(),
                    title: "Header.tsx",
                    url: "http://app.localhost/",
                  },
                },
              },
              {
                sessionId: "nvim-session",
                request: {
                  kind: "editor",
                  launcher: "neovim",
                  componentName: "Header",
                  source: {
                    fileName: "/src/Header.tsx",
                    lineNumber: 10,
                    columnNumber: 5,
                    componentName: "Header",
                  },
                  sourceLabel: "src/Header.tsx:10:5",
                },
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      return originalFetch.apply(window, [input, init]);
    }) as typeof fetch;

    window.__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__ = {
      render: (): void => {},
      isOpen: (): boolean => false,
      setIsOpen: (): void => {},
    };

    window.__ROUTER_DEVTOOLS_GLOBAL_HOOK__ = {
      render: (): void => {},
      isOpen: (): boolean => false,
      setIsOpen: (): void => {},
    };

    return (): void => {
      Reflect.deleteProperty(window, "__DEVHOST_INJECTED_CONFIG__");
      Reflect.deleteProperty(window, "__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__");
      Reflect.deleteProperty(window, "__ROUTER_DEVTOOLS_GLOBAL_HOOK__");
      Reflect.set(window, "WebSocket", originalWebSocket);
      window.fetch = originalFetch;
    };
  }, []);

  return <Story />;
}

interface IReactHighlightLayeringSceneProps {
  isPopover?: boolean;
}

export function ReactHighlightLayeringScene({ isPopover = false }: IReactHighlightLayeringSceneProps): JSX.Element {
  const panelId = useId();
  const [clickCount, setClickCount] = useState<number>(0);
  const cursorTargetsReference = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = cursorTargetsReference.current;
    if (container === null) {
      return;
    }

    // Real host DOM nodes with source metadata fixtures; their geometry and popover behavior come from the browser.
    const targets = ["First cursor target", "Second cursor target"].map((name) => {
      const target = container.ownerDocument.createElement("button");
      target.type = "button";
      target.textContent = name;
      Reflect.set(target, "__reactFiber$cursorStory", {
        _debugSource: { fileName: "/storybook-workspace/src/CursorTargets.tsx", lineNumber: 10, columnNumber: 5 },
        memoizedProps: {},
        type: { name: "CursorTarget" },
      });
      target.addEventListener("click", () => setClickCount((value) => value + 1));
      container.append(target);
      return target;
    });

    return () => targets.forEach((target) => target.remove());
  }, []);

  return (
    <>
      {isPopover ? (
        <button type="button" popoverTarget={panelId}>
          Open cursor target popover
        </button>
      ) : null}
      <section
        id={panelId}
        popover={isPopover ? "auto" : undefined}
        aria-label="Cursor targets"
        style={{ position: "fixed", inset: 100, margin: 0, padding: 40, background: "white", zIndex: 2147483647 }}
      >
        <div ref={cursorTargetsReference} style={{ display: "grid", gap: 20 }} />
        <output aria-label="Host clicks">{clickCount}</output>
      </section>
      <div style={{ position: "relative", zIndex: 0, transform: "translateZ(0)", contain: "paint", height: 1 }}>
        {renderInDevtoolsStoryShadowRoot(<DevtoolsApp />)}
      </div>
    </>
  );
}

export async function verifyReactHighlightLayering(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const appRoot = await shadowCanvas.findByTestId("AppContent");
  const shadowRoot = readShadowRoot(
    canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
    "Missing story shadow root.",
  );
  const targets = [
    canvas.getByRole("button", { name: "First cursor target" }),
    canvas.getByRole("button", { name: "Second cursor target" }),
  ];
  const diagnostics: unknown[] = [];
  const recordDiagnostic = (event: Event): void => {
    diagnostics.push(Reflect.get(event, "detail"));
  };
  window.addEventListener("devhost:react-highlight", recordDiagnostic);

  try {
    const overlays = await highlightReactElements("src/CursorTargets.tsx:10:5", "/storybook-workspace", appRoot);
    try {
      expect(overlays).toHaveLength(2);
      expect(diagnostics).toEqual([{ locator: "src/CursorTargets.tsx:10:5", matchedCount: 2 }]);

      const readRectangle = (element: HTMLElement): Pick<DOMRect, "x" | "y" | "width" | "height"> => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const targetRectangles = targets.map(readRectangle).sort((a, b) => a.y - b.y);
      const overlayRectangles = overlays.map(({ overlay }) => readRectangle(overlay)).sort((a, b) => a.y - b.y);
      expect(overlayRectangles).toEqual(targetRectangles);

      for (const { overlay } of overlays) {
        expect(overlay.parentElement).toBe(appRoot);
        const rectangle = overlay.getBoundingClientRect();
        // Include the passive rectangle in native hit testing only while checking the browser's paint order.
        overlay.style.pointerEvents = "auto";
        try {
          expect(shadowRoot.elementFromPoint(rectangle.left + rectangle.width / 2, rectangle.top + 1)).toBe(overlay);
        } finally {
          overlay.style.removeProperty("pointer-events");
        }
        expect(overlay.matches(":popover-open")).toBe(true);
      }

      await userEvent.click(canvas.getByRole("button", { name: "First cursor target" }));
      expect(canvas.getByRole("status", { name: "Host clicks" })).toHaveTextContent("1");
      expect(document.activeElement).toBe(canvas.getByRole("button", { name: "First cursor target" }));
    } finally {
      clearReactHighlightOverlays(overlays);
    }

    for (const { overlay } of overlays) {
      expect(overlay.isConnected).toBe(false);
      expect(overlay.matches(":popover-open")).toBe(false);
    }
    clearReactHighlightOverlays(overlays);
    const nextOverlays = await highlightReactElements("src/CursorTargets.tsx:10:5", "/storybook-workspace", appRoot);
    try {
      expect(nextOverlays).toHaveLength(2);
      for (const { overlay } of nextOverlays) {
        expect(overlay.matches(":popover-open")).toBe(true);
      }
    } finally {
      clearReactHighlightOverlays(nextOverlays);
    }
  } finally {
    window.removeEventListener("devhost:react-highlight", recordDiagnostic);
  }
}
