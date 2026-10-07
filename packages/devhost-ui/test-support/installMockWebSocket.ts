import { createMockWebSocket, type IMockWebSocketConnection } from "./createMockWebSocket";

type RestoreWebSocket = () => void;

export interface IInstalledMockWebSocket {
  /** How many sockets the code under test has made, including those the server refused. */
  attemptCount: number;
  /** Every connection the code under test has opened, oldest first. A socket connects one microtask after it is made. */
  connections: IMockWebSocketConnection[];
  /** While true, new sockets fail to connect, as they do while devhost is not running. */
  isRefusingConnections: boolean;
  restore: RestoreWebSocket;
}

/** Replaces `globalThis.WebSocket`, the constructor devtools control-plane clients use outside production. */
export function installMockWebSocket(): IInstalledMockWebSocket {
  const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");
  const installed: IInstalledMockWebSocket = {
    attemptCount: 0,
    connections: [],
    isRefusingConnections: false,
    restore: (): void => {
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    },
  };

  Reflect.set(
    globalThis,
    "WebSocket",
    createMockWebSocket(
      (connection: IMockWebSocketConnection): void => {
        installed.connections.push(connection);
      },
      (): boolean => {
        installed.attemptCount += 1;

        return !installed.isRefusingConnections;
      },
    ),
  );

  return installed;
}
