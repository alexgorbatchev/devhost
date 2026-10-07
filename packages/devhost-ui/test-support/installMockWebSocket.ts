import { createMockWebSocket, type IMockWebSocketConnection } from "./createMockWebSocket";

type RestoreWebSocket = () => void;

export interface IInstalledMockWebSocket {
  /** Every connection the code under test has opened, oldest first. A socket connects one microtask after it is made. */
  connections: IMockWebSocketConnection[];
  restore: RestoreWebSocket;
}

/** Replaces `globalThis.WebSocket`, the constructor devtools control-plane clients use outside production. */
export function installMockWebSocket(): IInstalledMockWebSocket {
  const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");
  const connections: IMockWebSocketConnection[] = [];

  Reflect.set(
    globalThis,
    "WebSocket",
    createMockWebSocket((connection: IMockWebSocketConnection): void => {
      connections.push(connection);
    }),
  );

  return {
    connections,
    restore: (): void => {
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    },
  };
}
