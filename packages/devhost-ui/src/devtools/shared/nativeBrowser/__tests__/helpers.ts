import type { NativeBrowserListener } from "../types";
import assert from "node:assert/strict";
import { z } from "zod";
import type { ServerWebSocket } from "bun";
import { createNativeBrowserClient } from "../createNativeBrowserClient";
import type { INativeBrowserClient, INativeBrowserObservation, INativeBrowserView } from "../types";

const requestSchema = z.strictObject({
  id: z.string(),
  command: z.enum(["connect", "open-react", "refresh"]),
  binding: z.strictObject({ instanceId: z.string(), documentId: z.string(), href: z.string() }),
});
type ControlRequest = z.infer<typeof requestSchema>;
type NativeBrowserViewPredicate = (view: INativeBrowserView) => boolean;

interface ITransportHarness {
  client: INativeBrowserClient;
  requests: ControlRequest[];
  configurationRequests: Request[];
  acknowledge: (request: ControlRequest, revision: number, state?: Partial<INativeBrowserObservation>) => void;
  send: (value: unknown) => void;
  waitForRequest: (index: number) => Promise<ControlRequest>;
  waitForClose: () => Promise<void>;
  dispose: () => Promise<void>;
}

// This is a real HTTP/WebSocket transport fixture, not a React inspector or a
// native-browser support proof. It deliberately exercises malformed and stale
// protocol responses that the genuine browser acceptance fixture cannot create.
export function createTransportHarness(hasNativeSessionLoss: boolean = false): ITransportHarness {
  const requests: ControlRequest[] = [];
  const configurationRequests: Request[] = [];
  let socket: ServerWebSocket<undefined> | null = null;
  const closures = new Set<NativeBrowserListener>();
  const requestReaders = new Set<NativeBrowserListener>();
  const state: INativeBrowserObservation = {
    isConnected: true,
    documentState: "bound",
    isReactAvailable: true,
    isNativeWindowOpen: false,
    isNativeSessionLost: false,
    browserVersion: "Chrome/154.0.8037.92",
    message: "Transport fixture observation.",
  };
  const acknowledge = (
    request: ControlRequest,
    revision: number,
    changes?: Partial<INativeBrowserObservation>,
  ): void => {
    assert(socket);
    socket.send(JSON.stringify({ type: "state", id: request.id, revision, state: { ...state, ...changes } }));
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/__devhost__/config.json") {
        configurationRequests.push(request);
        return Response.json(
          {
            nativeBrowserConfigured: true,
            nativeBrowserInstanceId: "11111111111111111111111111111111",
            externalToolbarsEnabled: true,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (server.upgrade(request)) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(current) {
        socket = current;
      },
      message(current, message) {
        socket = current;
        const value: unknown = JSON.parse(String(message));
        const request = requestSchema.parse(value);
        requests.push(request);
        for (const read of requestReaders) read();
        if (request.command === "connect") acknowledge(request, 1);
      },
      close() {
        for (const resolve of closures) resolve();
        closures.clear();
      },
    },
  });
  const client = createNativeBrowserClient({
    hasNativeSessionLoss,
    documentId: "22222222222222222222222222222222",
    fetch: globalThis.fetch,
    createSocket: (url, protocols) => new WebSocket(url, protocols),
    getHref: () => new URL("/project?counter=1", server.url).href,
  });
  return {
    client,
    requests,
    configurationRequests,
    acknowledge,
    send: (value) => {
      assert(socket);
      socket.send(JSON.stringify(value));
    },
    waitForRequest: (index) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          requestReaders.delete(read);
          reject(new Error("Expected wire request did not arrive."));
        }, 1000);
        const read = (): void => {
          const request = requests[index];
          if (request === undefined) return;
          clearTimeout(timeout);
          requestReaders.delete(read);
          resolve(request);
        };
        requestReaders.add(read);
        read();
      }),
    waitForClose: () => new Promise((resolve) => closures.add(resolve)),
    dispose: async () => {
      client.dispose();
      await server.stop(true);
    },
  };
}

export function waitForNativeView(
  client: INativeBrowserClient,
  predicate: NativeBrowserViewPredicate,
  timeoutMilliseconds: number = 1000,
): Promise<INativeBrowserView> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Expected transport state was not published."));
    }, timeoutMilliseconds);
    const observe = (): void => {
      const view = client.getSnapshot();
      if (!predicate(view)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(view);
    };
    const unsubscribe = client.subscribe(observe);
    observe();
  });
}
