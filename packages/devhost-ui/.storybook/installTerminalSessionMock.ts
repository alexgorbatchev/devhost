import { TERMINAL_SESSION_START_PATH } from "../src/devtools/shared/constants";
import type {
  ActiveTerminalSessionSnapshot,
  IListTerminalSessionsResponse,
  ITerminalSessionSnapshotMessage,
} from "../src/devtools/features/terminalSessions/types";
import { createMockWebSocket, type IMockWebSocketConnection } from "../test-support/createMockWebSocket";

type FetchRequestInput = Parameters<typeof fetch>[0];
type FetchRequestInit = Parameters<typeof fetch>[1];

export interface ITerminalSessionMock {
  /** How many sockets the page has made for the session, including those devhost turned away. */
  attemptCount: number;
  /** The connections the page has opened to the session, oldest first. */
  connections: IMockWebSocketConnection[];
  /** Once true, devhost no longer lists the session and turns its sockets away. */
  hasEnded: boolean;
  /** What the session has printed. A connection receives it as its snapshot when it attaches. */
  output: string;
  uninstall: () => void;
}

/**
 * Replaces `WebSocket` and `fetch` with a devhost that runs one terminal session, the one `snapshot` describes. The
 * story plays devhost through the returned mock: it drops connections, changes the output, and ends the session.
 */
export function installTerminalSessionMock(
  snapshot: ActiveTerminalSessionSnapshot,
  output: string,
): ITerminalSessionMock {
  const originalWebSocket: unknown = Reflect.get(globalThis, "WebSocket");
  const originalFetch = globalThis.fetch;
  const mock: ITerminalSessionMock = {
    attemptCount: 0,
    connections: [],
    hasEnded: false,
    output,
    uninstall: (): void => {
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
      globalThis.fetch = originalFetch;
    },
  };

  Reflect.set(
    globalThis,
    "WebSocket",
    createMockWebSocket(
      (connection: IMockWebSocketConnection): void => {
        const terminal: ITerminalSessionSnapshotMessage = { data: mock.output, type: "snapshot" };

        mock.connections.push(connection);
        connection.send(terminal);
      },
      (): boolean => {
        mock.attemptCount += 1;

        return !mock.hasEnded;
      },
    ),
  );
  globalThis.fetch = Object.assign(
    async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
      if (String(input) === TERMINAL_SESSION_START_PATH && init?.method === "GET") {
        const sessionList: IListTerminalSessionsResponse = { sessions: mock.hasEnded ? [] : [snapshot] };

        return Response.json(sessionList);
      }

      return originalFetch(input, init);
    },
    { preconnect: originalFetch.preconnect },
  );

  return mock;
}
