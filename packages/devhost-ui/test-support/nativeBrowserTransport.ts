import type { Plugin, ViteDevServer } from "vite";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";

import type { INativeBrowserObservation } from "../src/devtools/shared/nativeBrowser/types";

const pluginName: string = "devhost-native-browser-transport";
const configurationPath: string = "/__devhost__/config.json";
const controlSocketPath: string = "/__devhost__/ws/native-browser";
const controlRequestSchema = z.strictObject({
  id: z.string(),
  command: z.enum(["connect", "open-react", "refresh"]),
  binding: z.strictObject({ instanceId: z.string(), documentId: z.string(), href: z.string() }),
});

export type NativeBrowserControlRequest = z.infer<typeof controlRequestSchema>;

/** What the transport has seen from the page since the last reset. */
export interface INativeBrowserTransportState {
  activeSocketCount: number;
  closedSocketCount: number;
  configurationRequestCount: number;
  requests: NativeBrowserControlRequest[];
}

/** The transport of one test server, as the commands a hook test sends reach it. */
interface INativeBrowserTransport {
  /** Answers the page's control request at `index` with a state update at `revision`. */
  acknowledgeAction: (index: number, revision: number) => void;
  read: () => INativeBrowserTransportState;
  /** Forgets what the transport has seen. It refuses while a control socket is still open. */
  reset: () => void;
  /** Sends the page an observation it did not ask for. */
  sendObservation: (revision: number, changes: Partial<INativeBrowserObservation>) => void;
}

function createObservation(changes: Partial<INativeBrowserObservation>): INativeBrowserObservation {
  return {
    isConnected: true,
    documentState: "bound",
    isReactAvailable: true,
    isNativeWindowOpen: false,
    isNativeSessionLost: false,
    browserVersion: "Transport fixture",
    message: "Hook transport fixture; no native inspector is running.",
    ...changes,
  };
}

/**
 * Serves the native browser control plane from the server the hook tests' page comes from, so a hook under test
 * reaches it with the browser's own `fetch` and `WebSocket` at the page's origin, as it reaches devhost. This is
 * real HTTP and WebSocket transport, not a native inspector: observations are the fixture's.
 *
 * The plugin keeps what it has seen and exposes it as its `api`. Vitest evaluates a configuration file more than
 * once, so the commands look the transport up on the server that received the command.
 */
export function nativeBrowserTransport(): Plugin<INativeBrowserTransport> {
  const requests: NativeBrowserControlRequest[] = [];
  const sockets = new Set<WebSocket>();
  let closedSocketCount: number = 0;
  let configurationRequestCount: number = 0;

  const readOnlySocket = (): WebSocket => {
    const [socket] = sockets;

    if (socket === undefined || sockets.size !== 1) {
      throw new Error(`Expected one native browser control socket, found ${sockets.size}.`);
    }

    return socket;
  };
  const acceptSocket = (socket: WebSocket): void => {
    sockets.add(socket);
    socket.on("message", (data: unknown): void => {
      const message: unknown = JSON.parse(String(data));
      const request: NativeBrowserControlRequest = controlRequestSchema.parse(message);

      requests.push(request);
      if (request.command === "connect") {
        socket.send(JSON.stringify({ type: "state", id: request.id, revision: 1, state: createObservation({}) }));
      }
    });
    socket.on("close", (): void => {
      sockets.delete(socket);
      closedSocketCount += 1;
    });
  };

  return {
    name: pluginName,
    api: {
      acknowledgeAction: (index: number, revision: number): void => {
        const request: NativeBrowserControlRequest | undefined = requests[index];

        if (request === undefined) {
          throw new Error(`The page has not sent control request ${index + 1}.`);
        }

        readOnlySocket().send(
          JSON.stringify({ type: "state", id: request.id, revision, state: createObservation({}) }),
        );
      },
      read: (): INativeBrowserTransportState => {
        return {
          activeSocketCount: sockets.size,
          closedSocketCount,
          configurationRequestCount,
          requests: [...requests],
        };
      },
      reset: (): void => {
        if (sockets.size > 0) {
          throw new Error(`${sockets.size} native browser control sockets are still open.`);
        }

        requests.length = 0;
        closedSocketCount = 0;
        configurationRequestCount = 0;
      },
      sendObservation: (revision: number, changes: Partial<INativeBrowserObservation>): void => {
        readOnlySocket().send(JSON.stringify({ type: "state", revision, state: createObservation(changes) }));
      },
    },
    configureServer(server: ViteDevServer): void {
      const webSocketServer = new WebSocketServer({ noServer: true });

      server.middlewares.use(configurationPath, (_request, response): void => {
        configurationRequestCount += 1;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            nativeBrowserConfigured: true,
            nativeBrowserInstanceId: "11111111111111111111111111111111",
            externalToolbarsEnabled: true,
          }),
        );
      });
      // Vite and Vitest upgrade their own sockets on this server; every other path is left to them.
      server.httpServer?.on("upgrade", (request, socket, head): void => {
        if (new URL(request.url ?? "/", "http://hook-tests.invalid").pathname !== controlSocketPath) {
          return;
        }

        webSocketServer.handleUpgrade(request, socket, head, acceptSocket);
      });
    },
  };
}

function isNativeBrowserTransport(value: unknown): value is INativeBrowserTransport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "acknowledgeAction") === "function" &&
    typeof Reflect.get(value, "read") === "function" &&
    typeof Reflect.get(value, "reset") === "function" &&
    typeof Reflect.get(value, "sendObservation") === "function"
  );
}

/** The transport of the server the page that sent a command was loaded from. */
function readTransport(context: BrowserCommandContext): INativeBrowserTransport {
  // The test server runs Vitest's own Vite, whose plugin type is not the one this workspace declares.
  const transport: unknown = context.project.browser?.vite.config.plugins.find(
    (plugin) => plugin.name === pluginName,
  )?.api;

  if (!isNativeBrowserTransport(transport)) {
    throw new Error("The hook test server does not serve the native browser transport.");
  }

  return transport;
}

/** What a hook test asks the transport, from the page, through `commands` of `vitest/browser`. */
export const nativeBrowserTransportCommands = {
  acknowledgeNativeBrowserAction: (context, index: number, revision: number): void => {
    readTransport(context).acknowledgeAction(index, revision);
  },
  readNativeBrowserTransport: (context): INativeBrowserTransportState => readTransport(context).read(),
  resetNativeBrowserTransport: (context): void => {
    readTransport(context).reset();
  },
  sendNativeBrowserObservation: (context, revision: number, changes: Partial<INativeBrowserObservation>): void => {
    readTransport(context).sendObservation(revision, changes);
  },
} satisfies Record<string, BrowserCommand<never[]>>;
