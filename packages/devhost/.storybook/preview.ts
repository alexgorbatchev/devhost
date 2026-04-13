import type { Preview } from "@storybook/preact-vite";

import {
  DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME,
  HEALTH_WEBSOCKET_PATH,
  LOGS_WEBSOCKET_PATH,
  TERMINAL_SESSION_START_PATH,
  TERMINAL_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "../src/devtools/shared/constants";
import { configureDevtoolsCss, injectGlobal } from "../src/devtools/shared/devtoolsCss";
import type { IInjectedDevtoolsConfig } from "../src/devtools/shared/readInjectedDevtoolsConfig";

type FetchRequestInput = Parameters<typeof fetch>[0];
type StorybookWebSocketProtocols = ConstructorParameters<typeof WebSocket>[1];
type StorybookWebSocketSendData = Parameters<WebSocket["send"]>[0];
type StorybookWebSocketUrl = ConstructorParameters<typeof WebSocket>[0];

const storybookInjectedConfig: IInjectedDevtoolsConfig = {
  agentDisplayName: "Pi",
  componentEditor: "vscode",
  controlToken: "storybook-token",
  minimapPosition: "right",
  position: "bottom-right",
  projectRootPath: "storybook-workspace",
  stackName: "storybook-stack",
};

class MockStorybookWebSocket extends EventTarget {
  static readonly CONNECTING: number = 0;
  static readonly OPEN: number = 1;
  static readonly CLOSING: number = 2;
  static readonly CLOSED: number = 3;

  readonly url: string;
  binaryType: BinaryType = "blob";
  bufferedAmount: number = 0;
  extensions: string = "";
  protocol: string = "";
  readyState: number = MockStorybookWebSocket.CONNECTING;

  constructor(url: StorybookWebSocketUrl, _protocols?: StorybookWebSocketProtocols) {
    super();

    this.url = String(url);

    queueMicrotask((): void => {
      this.openConnection();
    });
  }

  close(code: number = 1000, reason: string = ""): void {
    if (this.readyState === MockStorybookWebSocket.CLOSING || this.readyState === MockStorybookWebSocket.CLOSED) {
      return;
    }

    this.readyState = MockStorybookWebSocket.CLOSING;

    queueMicrotask((): void => {
      this.readyState = MockStorybookWebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent("close", { code, reason }));
    });
  }

  send(_data: StorybookWebSocketSendData): void {}

  private emitMessage(data: string): void {
    this.dispatchEvent(new MessageEvent<string>("message", { data }));
  }

  private emitSnapshotMessages(): void {
    const requestUrl: URL = new URL(this.url, window.location.href);

    if (requestUrl.pathname === HEALTH_WEBSOCKET_PATH) {
      this.emitMessage(JSON.stringify({ services: [{ name: "api", status: true }] }));
      return;
    }

    if (requestUrl.pathname === LOGS_WEBSOCKET_PATH) {
      this.emitMessage(
        JSON.stringify({
          entries: [{ id: 1, line: "ready", serviceName: "api", stream: "stdout" }],
          type: "snapshot",
        }),
      );
      return;
    }

    if (requestUrl.pathname === TERMINAL_SESSION_WEBSOCKET_PATH) {
      this.emitMessage(JSON.stringify({ data: "$ echo ready\r\nready\r\n", type: "snapshot" }));
    }
  }

  private openConnection(): void {
    if (this.readyState !== MockStorybookWebSocket.CONNECTING) {
      return;
    }

    this.readyState = MockStorybookWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
    this.emitSnapshotMessages();
  }
}

function createStorybookFetch(): typeof fetch {
  return async (input, _init): Promise<Response> => {
    const requestUrl: URL = readRequestUrl(input);

    if (requestUrl.pathname === TERMINAL_SESSION_START_PATH) {
      return new Response(JSON.stringify({ sessionId: "storybook-session" }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  };
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

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
  },
  beforeEach() {
    const originalFetch: unknown = Reflect.get(globalThis, "fetch");
    const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");

    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, storybookInjectedConfig);
    Reflect.set(globalThis, "fetch", createStorybookFetch());
    Reflect.set(globalThis, "WebSocket", MockStorybookWebSocket);

    configureDevtoolsCss(document.head);
    injectGlobal({
      "*, *::before, *::after": {
        boxSizing: "border-box",
      },
      "@media (prefers-color-scheme: light)": {
        body: {
          backgroundColor: "#f3f4f6", // darker light
        },
      },
      "@media (prefers-color-scheme: dark)": {
        body: {
          backgroundColor: "#1f2937",
        },
      },
      button: {
        font: "inherit",
      },
      input: {
        font: "inherit",
      },
      textarea: {
        font: "inherit",
      },
    });

    return (): void => {
      Reflect.deleteProperty(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
      restoreGlobalValue("fetch", originalFetch);
      restoreGlobalValue("WebSocket", originalWebSocket);

      document.querySelectorAll(`link[href="${XTERM_STYLESHEET_PATH}"]`).forEach((element: Element): void => {
        element.remove();
      });
      document.querySelectorAll('style[data-emotion^="devhost"]').forEach((element: Element): void => {
        element.remove();
      });
    };
  },
};

export default preview;
