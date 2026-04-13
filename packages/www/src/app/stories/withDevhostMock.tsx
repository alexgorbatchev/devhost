import { useEffect, useRef, type JSX } from "react";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, createRoute, createRootRoute, RouterProvider } from "@tanstack/react-router";
import type { IInjectedDevtoolsConfig } from "@alexgorbatchev/devhost/src/devtools/shared/readInjectedDevtoolsConfig";

declare global {
  interface Window {
    __DEVHOST_INJECTED_CONFIG__?: IInjectedDevtoolsConfig;
  }
}

const rootRoute = createRootRoute();
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const routeTree = rootRoute.addChildren([indexRoute]);
const router = createRouter({ routeTree });

const queryClient = new QueryClient();

interface IDevhostMockDecoratorProps {
  Story: React.ComponentType;
}

type MockWebSocketUrl = string | URL;
type FetchRequestInput = Parameters<typeof fetch>[0];

interface IDevtoolsModule {
  renderDevtools: () => void;
}
type FetchRequestInit = Parameters<typeof fetch>[1];

export function withDevhostMock(Story: React.ComponentType): JSX.Element {
  return <DevhostMockDecorator Story={Story} />;
}

function DevhostMockDecorator({ Story }: IDevhostMockDecoratorProps): JSX.Element {
  const isSetup = useRef<boolean>(false);

  useEffect(() => {
    if (isSetup.current) {
      return;
    }

    isSetup.current = true;

    window.__DEVHOST_INJECTED_CONFIG__ = {
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      controlToken: "mock-token",
      minimapPosition: "right",
      position: "bottom-right",
      projectRootPath: "/storybook-workspace",
      stackName: "storybook-stack",
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      statusEnabled: true,
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
        queueMicrotask((): void => {
          this.openConnection();
        });
      }

      close(code: number = 1000, reason: string = ""): void {
        if (this.readyState === MockWebSocket.CLOSING || this.readyState === MockWebSocket.CLOSED) {
          return;
        }

        this.readyState = MockWebSocket.CLOSING;

        queueMicrotask((): void => {
          this.readyState = MockWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent("close", { code, reason }));
        });
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
                { name: "app", status: true },
                { name: "api", status: true },
                { name: "worker", status: false },
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
              JSON.stringify({ data: "\u001b[32m~ \u001b[34mNeovim is running...\u001b[0m\r\n", type: "snapshot" }),
            );
          } else {
            this.emitMessage(JSON.stringify({ data: "Agent Pi is ready.\r\n", type: "snapshot" }));
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

      if (url.includes("/terminal-sessions") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            sessions: [
              {
                sessionId: "pi-session",
                request: {
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

      return originalFetch(input, init);
    }) as typeof fetch;

    import("@alexgorbatchev/devhost/src/devtools" as unknown as string)
      .then((m: unknown) => (m as IDevtoolsModule).renderDevtools())
      .catch(console.error);

    return (): void => {
      Reflect.deleteProperty(window, "__DEVHOST_INJECTED_CONFIG__");
      Reflect.set(window, "WebSocket", originalWebSocket);
      window.fetch = originalFetch;

      const host: HTMLElement | null = document.getElementById("devhost-devtools-host");

      if (host !== null) {
        host.remove();
      }
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <>
        <Story />
        <RouterProvider router={router} />
        <ReactQueryDevtools initialIsOpen={false} />
        <TanStackRouterDevtools router={router} />
      </>
    </QueryClientProvider>
  );
}
