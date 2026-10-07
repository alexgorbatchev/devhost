import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { z } from "zod";
import type { ServerWebSocket } from "bun";
import type { INativeBrowserObservation } from "../../nativeBrowser/types";

const NativeResponse = globalThis.Response;
const NativeWebSocket = globalThis.WebSocket;
const requestSchema = z.strictObject({
  id: z.string(),
  command: z.enum(["connect", "open-react", "refresh"]),
  binding: z.strictObject({ instanceId: z.string(), documentId: z.string(), href: z.string() }),
});
type HookControlRequest = z.infer<typeof requestSchema>;
const requests: HookControlRequest[] = [];
const configurationRequests: Request[] = [];
const sockets = new Set<ServerWebSocket<undefined>>();
let closedSockets: number = 0;

// Genuine loopback transport only. These protocol observations do not certify an inspector.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, currentServer) {
    if (new URL(request.url).pathname === "/__devhost__/config.json") {
      configurationRequests.push(request);
      return NativeResponse.json(
        {
          nativeBrowserConfigured: true,
          nativeBrowserInstanceId: "11111111111111111111111111111111",
          externalToolbarsEnabled: true,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (currentServer.upgrade(request)) return;
    return new NativeResponse("Not found", { status: 404 });
  },
  websocket: {
    open(socket) {
      sockets.add(socket);
    },
    message(socket, value) {
      const message: unknown = JSON.parse(String(value));
      const request = requestSchema.parse(message);
      requests.push(request);
      if (request.command === "connect")
        socket.send(
          JSON.stringify({
            type: "state",
            id: request.id,
            revision: 1,
            state: createObservation(),
          }),
        );
    },
    close(socket) {
      sockets.delete(socket);
      closedSockets++;
    },
  },
});

GlobalRegistrator.register({ url: new URL("/hook-project?counter=1", server.url).href });
// Happy DOM exposes OPEN only on its constructor. Keep Bun's real WebSocket
// for this genuine transport test; unregister restores the original descriptor.
Reflect.set(globalThis, "WebSocket", NativeWebSocket);

function createObservation(changes?: Partial<INativeBrowserObservation>): INativeBrowserObservation {
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

export const hookTransport = {
  requests,
  configurationRequests,
  readActiveSockets: (): number => sockets.size,
  readClosedSockets: (): number => closedSockets,
  sendObservation: (revision: number, changes?: Partial<INativeBrowserObservation>): void => {
    const socket = sockets.values().next().value;
    assert(socket);
    socket.send(JSON.stringify({ type: "state", revision, state: createObservation(changes) }));
  },
  acknowledgeAction: (index: number, revision: number): void => {
    const request = requests[index];
    const socket = sockets.values().next().value;
    assert(request);
    assert(socket);
    socket.send(JSON.stringify({ type: "state", id: request.id, revision, state: createObservation() }));
  },
  reset: (): void => {
    assert.equal(sockets.size, 0);
    requests.length = 0;
    configurationRequests.length = 0;
    closedSockets = 0;
  },
};

export async function disposeHookTransport(): Promise<void> {
  await server.stop(true);
  await GlobalRegistrator.unregister();
}
