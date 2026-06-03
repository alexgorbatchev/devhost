import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "storybook/test";
import { useEffect, useRef, type JSX, type ComponentType } from "react";

import { App as DevtoolsApp } from "../App";
import { renderDevtools } from "../../renderDevtools";
import { DEVTOOLS_HOST_ID } from "../../shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../shared/constants";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../shared/components/stories/helpers";
import { StoryContainer } from "@/devtools/shared/components/stories/helpers";
import { withDevhostMock } from "./helpers";
import { registerAnnotationSelectionPlugin } from "../../features/annotationComposer";

const meta: Meta<typeof DevtoolsApp> = {
  title: "@alexgorbatchev/devhost-ui/devtools/components/App",
  component: DevtoolsApp,
  decorators: [withDevhostMock],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const App: Story = {
  render: () =>
    renderInDevtoolsStoryShadowRoot(
      <StoryContainer>
        <DevtoolsApp />
      </StoryContainer>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowRoot = await readStoryShadowRoot(canvasElement);

    expect(shadowRoot.querySelector("[data-testid='AppContent']")).not.toBeNull();

    await waitFor(() => {
      expect(shadowRoot.querySelector("[data-testid='ServiceStatusPanel']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='LogMinimap']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='AnnotationComposer']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='AnnotationQueuePanel']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='TerminalSessionTray']")).not.toBeNull();
    });

    expect(shadowRoot.querySelector("[data-testid='ServiceStatusPanel--service-list']")).not.toBeNull();
    expect(shadowRoot.querySelector("[data-testid='LogMinimap--canvas']")).not.toBeNull();
    expect(shadowRoot.querySelector("[data-testid='AnnotationQueuePanel--queue-list']")).not.toBeNull();
    expect(shadowRoot.querySelector("[data-testid='TerminalSessionTray--session-list']")).not.toBeNull();
    expect(shadowRoot.querySelector("[data-testid='TerminalSessionPanel--expand']")).not.toBeNull();
  },
};

export const InjectedMount: Story = {
  render: () => <InjectedMountStory />,
  play: async (): Promise<void> => {
    await waitFor(() => {
      const hostElement = document.getElementById(DEVTOOLS_HOST_ID);
      expect(hostElement).not.toBeNull();
      expect(hostElement?.getAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME)).toBe("");
      expect(hostElement?.shadowRoot).not.toBeNull();
      expect(hostElement?.shadowRoot?.querySelector("[data-testid='AppContent']")).not.toBeNull();
    });
  },
};

export const DesignOverview: Story = {
  decorators: [withDesignOverviewMock],
  tags: ["!test"],
  render: () => <DesignOverviewScene />,
  play: async ({ canvasElement }): Promise<void> => {
    const shadowHost = await within(canvasElement).findByTestId(devtoolsStoryShadowRootHostTestId);
    const shadowRoot = readShadowRoot(shadowHost, "Expected the App story to attach a shadow root.");
    const shadowCanvas = within(shadowRoot as unknown as HTMLElement);

    // 1. Wait for devtools to render
    await waitFor(
      () => {
        const expandButtons = shadowCanvas.queryAllByTestId("TerminalSessionPanel--expand");
        expect(expandButtons.length).toBe(2);
      },
      { timeout: 10000 },
    );

    // 2. Select elements: Enter selection mode
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));

    // 3. Find target elements
    const button = document.querySelector('[data-mock-target="button"]');
    const card = document.querySelector('[data-mock-target="card"]');

    if (button && card) {
      // Click button
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      // Click card
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }

    // 4. Exit selection mode
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));

    // 5. Populate description text in the textarea
    await waitFor(
      () => {
        const textarea = shadowRoot.querySelector("[data-testid='AnnotationComposer--comment']") as HTMLTextAreaElement;
        expect(textarea).not.toBeNull();
      },
      { timeout: 5000 },
    );

    const textarea = shadowRoot.querySelector("[data-testid='AnnotationComposer--comment']") as HTMLTextAreaElement;
    if (textarea) {
      textarea.value =
        "Change primary button (#1) to modern border-radius and color to match the design spec shown in the card (#2)";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  },
};

function InjectedMountStory(): null {
  useEffect(() => {
    renderDevtools();

    return () => {
      document.getElementById(DEVTOOLS_HOST_ID)?.remove();
    };
  }, []);

  return null;
}

async function readStoryShadowRoot(canvasElement: HTMLElement): Promise<ShadowRoot> {
  const canvas = within(canvasElement);
  const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(shadowHost, "Expected the App story to attach a shadow root.");

  await expect(shadowHost.shadowRoot).toBe(shadowRoot);

  return shadowRoot;
}

interface IDesignOverviewMockDecoratorProps {
  Story: ComponentType;
}

type MockWebSocketUrl = string | URL;

function withDesignOverviewMock(Story: ComponentType): JSX.Element {
  return <DesignOverviewMockDecorator Story={Story} />;
}

function DesignOverviewMockDecorator({ Story }: IDesignOverviewMockDecoratorProps): JSX.Element {
  const isSetup = useRef<boolean>(false);

  useEffect(() => {
    if (isSetup.current) {
      return;
    }

    isSetup.current = true;

    window.__DEVHOST_INJECTED_CONFIG__ = {
      annotationActions: [
        { displayName: "Pi", id: "agent", kind: "agent", queueEnabled: true },
        { displayName: "Audit", id: "cmd", kind: "command", queueEnabled: false },
      ],
      annotationDefaultActionId: "agent",
      componentEditor: "vscode",
      controlToken: "mock-token-overview",
      position: "bottom-right",
      projectRootPath: "/overview-workspace",
      stackName: "overview-stack",
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
                { managed: true, name: "worker", status: true },
                { managed: true, name: "db", status: true },
                { managed: true, name: "cache", status: true },
                { managed: true, name: "cron", status: true },
              ],
            }),
          );
        } else if (requestUrl.pathname.includes("/ws/logs")) {
          this.emitMessage(
            JSON.stringify({
              type: "snapshot",
              entries: [
                { id: 1, line: "DB connection pool initialized (10 connections)", serviceName: "db", stream: "stdout" },
                { id: 2, line: "Cache warm-up completed: 1,240 keys loaded", serviceName: "cache", stream: "stdout" },
                { id: 3, line: "Registering message handlers...", serviceName: "worker", stream: "stdout" },
                { id: 4, line: "Broker connected successfully to RabbitMQ", serviceName: "worker", stream: "stdout" },
                { id: 5, line: "API router registered 18 endpoints", serviceName: "api", stream: "stdout" },
                { id: 6, line: "GET /healthz 200 OK - 2.5ms", serviceName: "api", stream: "stdout" },
                { id: 7, line: "GET /v1/user/profile 200 OK - 12.8ms", serviceName: "api", stream: "stdout" },
                {
                  id: 8,
                  line: "[WARN] Deprecated endpoint /v1/legacy-auth accessed",
                  serviceName: "api",
                  stream: "stdout",
                },
                {
                  id: 9,
                  line: "POST /v1/billing/checkout 500 Internal Server Error",
                  serviceName: "api",
                  stream: "stderr",
                },
                {
                  id: 10,
                  line: "[ERROR] Stripe checkout token invalid or expired",
                  serviceName: "api",
                  stream: "stderr",
                },
                {
                  id: 11,
                  line: "Job scheduler initialized (3 active cron triggers)",
                  serviceName: "cron",
                  stream: "stdout",
                },
                { id: 12, line: "Running scheduled job: clean_stale_sessions", serviceName: "cron", stream: "stdout" },
                { id: 13, line: "Database backup started...", serviceName: "db", stream: "stdout" },
                { id: 14, line: "Database backup completed (size: 42MB)", serviceName: "db", stream: "stdout" },
                { id: 15, line: "Listening on http://app.localhost", serviceName: "app", stream: "stdout" },
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
                        comment: "Change primary button to modern border-radius and color",
                        markers: [],
                        stackName: "overview-stack",
                        submittedAt: Date.now() - 50000,
                        title: "WelcomeSection.tsx",
                        url: "http://app.localhost/",
                      },
                    },
                  ],
                },
              ],
            }),
          );
        } else if (requestUrl.pathname.includes("/ws/terminal")) {
          const sessionId = requestUrl.searchParams.get("sessionId");

          if (sessionId === "pi-session") {
            this.emitMessage(
              JSON.stringify({
                data: "\u001b[32m[agent:pi] \u001b[36mRunning workspace task:\u001b[0m Update the Get Started button to indigo theme\r\n\u001b[34m[agent:pi] Inspecting /src/WelcomeSection.tsx...\u001b[0m\r\n\u001b[33m[agent:pi] Applying inline JSX replacement at line 15\u001b[0m\r\n\u001b[1;32m✓ Replacement applied successfully!\u001b[0m\r\n\u001b[34m[agent:pi] Running build:devhost verification...\u001b[0m\r\n\u001b[1;32m✓ All package-local checks passed!\u001b[0m\r\n",
                type: "snapshot",
              }),
            );
          } else if (sessionId === "nvim-session") {
            this.emitMessage(
              JSON.stringify({
                data: '\u001b[1;35mWelcomeSection.tsx\u001b[0m\r\n\u001b[34m 12 | \u001b[0m\u001b[32mexport function \u001b[1;36mWelcomeSection\u001b[0m() {\r\n\u001b[34m 13 | \u001b[0m  \u001b[32mreturn (\r\n\u001b[34m 14 | \u001b[0m    \u001b[33m<section \u001b[1;32mclassName\u001b[0m\u001b[35m=\u001b[0m\u001b[31m"bg-slate-950 p-6 rounded-lg"\u001b[33m>\u001b[0m\r\n\u001b[34m 15 | \u001b[0m      \u001b[33m<button \u001b[1;32mclassName\u001b[0m\u001b[35m=\u001b[0m\u001b[31m"px-4 py-1.5 bg-indigo-600 rounded text-white"\u001b[33m>\u001b[0m\r\n\u001b[34m 16 | \u001b[0m        Get Started\r\n\u001b[34m 17 | \u001b[0m      \u001b[33m</button>\u001b[0m\r\n',
                type: "snapshot",
              }),
            );
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

    window.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;

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
                    comment: "Change primary button to modern border-radius and color",
                    markers: [],
                    stackName: "overview-stack",
                    submittedAt: Date.now(),
                    title: "WelcomeSection.tsx",
                    url: "http://app.localhost/",
                  },
                },
              },
              {
                sessionId: "nvim-session",
                request: {
                  kind: "editor",
                  launcher: "neovim",
                  componentName: "WelcomeSection",
                  source: {
                    fileName: "/src/WelcomeSection.tsx",
                    lineNumber: 15,
                    columnNumber: 8,
                    componentName: "WelcomeSection",
                  },
                  sourceLabel: "src/WelcomeSection.tsx:15:8",
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

    const unregisterSelectionPlugin = registerAnnotationSelectionPlugin({
      id: "mock-overview-selection",
      label: "Mock Selection",
      priority: 100,
      matches: () => true,
      resolveCandidate: (event: MouseEvent) => {
        const button = document.querySelector('[data-mock-target="button"]');
        const card = document.querySelector('[data-mock-target="card"]');

        if (button && (event.target === button || button.contains(event.target as Node))) {
          return {
            id: "hl-btn",
            label: "WelcomeSection > button",
            buildMarkerPayload: async (markerNumber: number) => ({
              accessibility: "",
              boundingBox: { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
              computedStyles: "",
              computedStylesObj: {},
              cssClasses: "",
              element: "button",
              elementPath: "button",
              fullPath: "button",
              isFixed: false,
              markerNumber,
              nearbyElements: "",
              nearbyText: "",
            }),
            readRect: () => button.getBoundingClientRect(),
          };
        }

        if (card && (event.target === card || card.contains(event.target as Node))) {
          return {
            id: "hl-card",
            label: "ServiceHealthPanel",
            buildMarkerPayload: async (markerNumber: number) => ({
              accessibility: "",
              boundingBox: { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
              computedStyles: "",
              computedStylesObj: {},
              cssClasses: "",
              element: "div",
              elementPath: "div",
              fullPath: "div",
              isFixed: false,
              markerNumber,
              nearbyElements: "",
              nearbyText: "",
            }),
            readRect: () => card.getBoundingClientRect(),
          };
        }

        return null;
      },
    });

    return (): void => {
      Reflect.deleteProperty(window, "__DEVHOST_INJECTED_CONFIG__");
      Reflect.deleteProperty(window, "__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__");
      Reflect.deleteProperty(window, "__ROUTER_DEVTOOLS_GLOBAL_HOOK__");
      Reflect.set(window, "WebSocket", originalWebSocket);
      window.fetch = originalFetch;
      unregisterSelectionPlugin();
    };
  }, []);

  return <Story />;
}

function DesignOverviewScene(): JSX.Element {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "750px",
        width: "100%",
        padding: "16px",
        backgroundColor: "#0f172a",
        color: "#f8fafc",
        fontFamily: "sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        boxSizing: "border-box",
      }}
    >
      {/* Host Page Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          backgroundColor: "rgba(2, 6, 23, 0.8)",
          borderRadius: "6px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "4px",
              backgroundColor: "#6366f1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "monospace",
              fontSize: "12px",
              fontWeight: "bold",
              color: "#ffffff",
            }}
          >
            D
          </div>
          <span style={{ fontWeight: 600, fontSize: "14px", letterSpacing: "-0.01em", color: "#ffffff" }}>
            Devhost Dashboard
          </span>
        </div>
        <nav style={{ display: "flex", gap: "16px", fontSize: "12px", fontWeight: 500, color: "#94a3b8" }}>
          <span style={{ color: "#f1f5f9" }}>Dashboard</span>
          <span>Deployments</span>
          <span>Metrics</span>
          <span>Settings</span>
        </nav>
      </header>

      {/* Main Content Areas */}
      <main
        style={{
          flex: "1 1 0%",
          maxWidth: "896px",
          margin: "0 auto",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
          boxSizing: "border-box",
        }}
      >
        <section
          style={{
            backgroundColor: "#020617",
            padding: "24px",
            borderRadius: "8px",
            border: "1px solid #1e293b",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", color: "#ffffff" }}>
            Build & Dev Environment Overview
          </h1>
          <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "512px" }}>
            Welcome to your live developer workspace. The Devhost container is running on your localhost domain. We've
            highlighted key interactive interface elements on the host app to showcase how Agent Pi can trace,
            source-map, and rewrite components inline.
          </p>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              data-mock-target="button"
              type="button"
              style={{
                cursor: "pointer",
                padding: "6px 16px",
                backgroundColor: "#4f46e5",
                border: "none",
                color: "#ffffff",
                fontWeight: 500,
                fontSize: "12px",
                borderRadius: "4px",
              }}
            >
              Get Started
            </button>
            <button
              type="button"
              style={{
                cursor: "pointer",
                padding: "6px 16px",
                backgroundColor: "#1e293b",
                border: "none",
                color: "#f1f5f9",
                fontWeight: 500,
                fontSize: "12px",
                borderRadius: "4px",
              }}
            >
              Read Documentation
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", boxSizing: "border-box" }}>
          <div
            data-mock-target="card"
            style={{
              backgroundColor: "#020617",
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid #1e293b",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              boxSizing: "border-box",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#ffffff" }}>Service Health status</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#34d399" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "9999px", backgroundColor: "#34d399" }} />
              <span>All 6 microservices operational</span>
            </div>
            <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8", lineHeight: 1.4 }}>
              Active logs are being streamed dynamically into the visual minimap on the right.
            </p>
          </div>

          <div
            style={{
              backgroundColor: "#020617",
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid #1e293b",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              boxSizing: "border-box",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#ffffff" }}>Newsletter Signup</h3>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="email"
                placeholder="you@example.com"
                style={{
                  flex: "1 1 0%",
                  backgroundColor: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: "4px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: "#f1f5f9",
                  outline: "none",
                }}
              />
              <button
                type="button"
                style={{
                  cursor: "pointer",
                  padding: "4px 12px",
                  backgroundColor: "#4f46e5",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 500,
                  borderRadius: "4px",
                }}
              >
                Subscribe
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Render Devtools UI in the Shadow DOM Root */}
      {renderInDevtoolsStoryShadowRoot(<DevtoolsApp />)}
    </div>
  );
}
