import React from "react";
import type { Decorator, Preview } from "@storybook/react";
import { configure } from "storybook/test";

import "../src/devtools/shared/devtools.css";
import {
  DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME,
  HEALTH_WEBSOCKET_PATH,
  LOGS_WEBSOCKET_PATH,
  RESTART_STACK_PATH,
  TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_START_PATH,
  TERMINAL_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "../src/devtools/shared/constants";
import type {
  IListTerminalSessionsResponse,
  IStartTerminalSessionResponse,
  ITerminalSessionExitMessage,
  ITerminalSessionSnapshotMessage,
} from "../src/devtools/features/terminalSessions/types";
import type { DevtoolsColorScheme } from "../src/devtools/shared";
import type { IInjectedDevtoolsConfig } from "../src/devtools/shared/readInjectedDevtoolsConfig";
import { registerDevtoolsFonts } from "../src/devtools/shared/registerDevtoolsFonts";
import {
  readStorybookPreviewTheme,
  readStorybookDevtoolsColorScheme,
  storybookDevtoolsThemeGlobalName,
} from "../src/devtools/shared/storybookTheme";
import type { HealthResponse, ServiceLogSnapshotMessage } from "../src/devtools/shared/types";
import { createMockWebSocket, type IMockWebSocketConnection } from "../test-support/createMockWebSocket";

type FetchRequestInput = Parameters<typeof fetch>[0];
type FetchRequestInit = Parameters<typeof fetch>[1];
type FetchPreconnect = typeof fetch.preconnect;

const storybookAsyncUtilTimeoutMs: number = 5000;

const storybookInjectedConfig: IInjectedDevtoolsConfig = {
  nativeBrowserConfigured: false,
  nativeBrowserInstanceId: "",
  annotationActions: [],
  annotationDefaultActionId: "",
  annotationEnabled: false,
  annotationQueueEnabled: false,
  componentEditor: "vscode",
  homeDirectoryPath: "/home/alex",
  editorEnabled: true,
  externalToolbarsEnabled: true,
  minimapEnabled: true,
  resourcesEnabled: false,
  position: "bottom-right",
  projectRootPath: "storybook-workspace",
  routedServices: [],
  stackName: "storybook-stack",
  statusEnabled: true,
  terminalEnabled: true,
};

function sendStorybookSnapshot(connection: IMockWebSocketConnection): void {
  if (connection.url.pathname === HEALTH_WEBSOCKET_PATH) {
    const health: HealthResponse = { services: [{ name: "api", managed: true, status: true }] };

    connection.send(health);
    return;
  }

  if (connection.url.pathname === LOGS_WEBSOCKET_PATH) {
    const logs: ServiceLogSnapshotMessage = {
      entries: [{ id: 1, line: "ready", serviceName: "api", stream: "stdout" }],
      type: "snapshot",
    };

    connection.send(logs);
    return;
  }

  if (connection.url.pathname === TERMINAL_SESSION_WEBSOCKET_PATH) {
    const sessionId: string | null = connection.url.searchParams.get(TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME);
    const terminal: ITerminalSessionSnapshotMessage = {
      data:
        sessionId === "session-contrast"
          ? "\u001b[30mX\u001b[0m \u001b[92mG\u001b[0m \u001b[93mY\u001b[0m \u001b[96mC\u001b[0m \u001b[97mW\u001b[0m"
          : "$ echo ready\r\nready\r\n",
      type: "snapshot",
    };

    connection.send(terminal);

    if (sessionId === "session-finished") {
      const exit: ITerminalSessionExitMessage = { exitCode: 0, signalCode: null, type: "exit" };

      queueMicrotask((): void => {
        connection.send(exit);
      });
    }
  }
}

function createStorybookFetch(): typeof fetch {
  const preconnect: FetchPreconnect = (...args): ReturnType<FetchPreconnect> => {
    const fetchPreconnect: unknown = Reflect.get(globalThis.fetch, "preconnect");

    if (typeof fetchPreconnect === "function") {
      return fetchPreconnect(...args);
    }

    return undefined;
  };

  const storybookFetch: typeof fetch = Object.assign(
    async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
      const requestUrl: URL = readRequestUrl(input);

      if (requestUrl.pathname === RESTART_STACK_PATH) return new Response(null, { status: 204 });

      // As on the control server: POST starts a session, GET lists the running ones. None runs by default.
      if (requestUrl.pathname === TERMINAL_SESSION_START_PATH) {
        if (readRequestMethod(input, init) === "POST") {
          const startedSession: IStartTerminalSessionResponse = { sessionId: "storybook-session" };

          return Response.json(startedSession);
        }

        const sessionList: IListTerminalSessionsResponse = { sessions: [] };

        return Response.json(sessionList);
      }

      return new Response("Not found", { status: 404 });
    },
    {
      preconnect,
    },
  );

  return storybookFetch;
}

function readRequestMethod(input: FetchRequestInput, init?: FetchRequestInit): string {
  if (init?.method !== undefined) {
    return init.method;
  }

  return input instanceof Request ? input.method : "GET";
}

function readRequestUrl(input: FetchRequestInput): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }

  return new URL(String(input), window.location.href);
}

function restoreGlobalValue(name: string, value: unknown): void {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, name);
    return;
  }

  Reflect.set(globalThis, name, value);
}

const withDevtoolsColorScheme: Decorator = (Story, context) => {
  const colorScheme: DevtoolsColorScheme = readStorybookDevtoolsColorScheme(context.globals);
  const previewTheme = readStorybookPreviewTheme(colorScheme);

  return (
    <div
      style={{
        backgroundColor: previewTheme.backgroundColor,
        color: previewTheme.color,
        colorScheme: previewTheme.colorScheme,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  beforeAll() {
    // Native devtools lazy-load their panels while browser stories run in parallel.
    // Keep polling observable state instead of treating one second as a startup deadline.
    configure({ asyncUtilTimeout: storybookAsyncUtilTimeoutMs });
  },
  decorators: [withDevtoolsColorScheme],
  globalTypes: {
    [storybookDevtoolsThemeGlobalName]: {
      description: "Devhost UI color scheme",
    },
  },
  initialGlobals: {
    [storybookDevtoolsThemeGlobalName]: "dark",
  },
  parameters: {
    layout: "fullscreen",
  },
  beforeEach() {
    const originalFetch: unknown = Reflect.get(globalThis, "fetch");
    const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");

    registerDevtoolsFonts(document.fonts);
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, storybookInjectedConfig);
    Reflect.set(globalThis, "fetch", createStorybookFetch());
    Reflect.set(globalThis, "WebSocket", createMockWebSocket(sendStorybookSnapshot));

    return (): void => {
      Reflect.deleteProperty(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
      restoreGlobalValue("fetch", originalFetch);
      restoreGlobalValue("WebSocket", originalWebSocket);

      document.querySelectorAll(`link[href="${XTERM_STYLESHEET_PATH}"]`).forEach((element: Element): void => {
        element.remove();
      });
    };
  },
};

export default preview;
