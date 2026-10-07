import assert from "node:assert";

import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import type { IMockWebSocketConnection } from "../../../../../test-support/createMockWebSocket";
import { installMockWebSocket, type IInstalledMockWebSocket } from "../../../../../test-support/installMockWebSocket";
import type { FetchFunction } from "../../../shared/pristineFetch";
import { openTerminalSessionStream, type ITerminalSessionStream } from "../openTerminalSessionStream";
import type { ActiveTerminalSessionSnapshot, TerminalSessionStatus } from "../types";

type StatusReport = [status: TerminalSessionStatus, errorMessage: string | null];
type PendingSessionList = PromiseWithResolvers<Response>;

const SESSION_SNAPSHOT: ActiveTerminalSessionSnapshot = {
  request: {
    componentName: "SaveButton",
    kind: "editor",
    launcher: "neovim",
    source: { columnNumber: 3, fileName: "src/SaveButton.tsx", lineNumber: 12 },
    sourceLabel: "src/SaveButton.tsx:12:3",
  },
  sessionId: "editor-session",
};

let webSocket: IInstalledMockWebSocket;
let statusReports: StatusReport[];
let terminalText: string;
let openCount: number;
// How devhost answers a request for its session list.
let fetchSessionList: FetchFunction;

function listSessions(sessions: ActiveTerminalSessionSnapshot[]): FetchFunction {
  return async (): Promise<Response> => Response.json({ sessions });
}

// Devhost is not running, so the request fails the way `fetch` does without a server.
const failToFetch: FetchFunction = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));

function openStream(): ITerminalSessionStream {
  return openTerminalSessionStream({
    fetch: (input, init): Promise<Response> => fetchSessionList(input, init),
    location: { host: "shop.example.test", protocol: "https:" },
    onOpen: (): void => {
      openCount += 1;
    },
    onOutput: (data: string): void => {
      terminalText += data;
    },
    onSnapshot: (data: string): void => {
      terminalText = data;
    },
    onStatusChange: (status: TerminalSessionStatus, errorMessage: string | null): void => {
      statusReports.push([status, errorMessage]);
    },
    sessionId: "editor-session",
  });
}

// Runs what is already due: a socket opening or closing, and the answer to a session list request.
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

async function passTime(milliseconds: number): Promise<void> {
  jest.advanceTimersByTime(milliseconds);
  await settle();
}

function readConnection(index: number): IMockWebSocketConnection {
  const connection: IMockWebSocketConnection | undefined = webSocket.connections[index];

  assert(connection !== undefined);

  return connection;
}

function readLastStatus(): StatusReport | undefined {
  return statusReports.at(-1);
}

beforeEach(() => {
  jest.useFakeTimers();
  webSocket = installMockWebSocket();
  statusReports = [];
  terminalText = "";
  openCount = 0;
  fetchSessionList = listSessions([SESSION_SNAPSHOT]);
});

afterEach(() => {
  jest.useRealTimers();
  webSocket.restore();
});

describe("openTerminalSessionStream", () => {
  test("attaches to the session and reports its output and its exit", async () => {
    openStream();
    await settle();

    const connection = readConnection(0);

    expect(connection.url.href).toBe("wss://shop.example.test/__devhost__/ws/terminal?sessionId=editor-session");
    expect(statusReports).toEqual([["running", null]]);
    expect(openCount).toBe(1);

    connection.send({ data: "$ ls\r\n", type: "snapshot" });
    connection.send({ data: "README.md\r\n", type: "output" });
    expect(terminalText).toBe("$ ls\r\nREADME.md\r\n");

    connection.send({ exitCode: 0, signalCode: null, type: "exit" });
    expect(readLastStatus()).toEqual(["exited", null]);
  });

  test("reports the server's errors and messages it cannot read", async () => {
    openStream();
    await settle();

    const connection = readConnection(0);

    connection.send({ message: "Invalid terminal message.", type: "error" });
    expect(readLastStatus()).toEqual(["error", "Invalid terminal message."]);

    connection.send({ data: 42, type: "output" });
    expect(readLastStatus()).toEqual(["error", "Received an invalid terminal message."]);

    statusReports = [];
    connection.sendFrame("{");
    connection.sendFrame(new ArrayBuffer(1));
    expect(statusReports).toEqual([
      ["error", "Received an invalid terminal message."],
      ["error", "Received an invalid terminal message."],
    ]);
    expect(terminalText).toBe("");
  });

  test("sends client messages over the open connection only", async () => {
    const stream = openStream();

    stream.send({ data: "early", type: "input" });
    await settle();

    const connection = readConnection(0);

    stream.send({ data: "ls\r", type: "input" });
    stream.send({ cols: 120, rows: 40, type: "resize" });
    expect(connection.readSentFrames()).toEqual([
      '{"data":"ls\\r","type":"input"}',
      '{"cols":120,"rows":40,"type":"resize"}',
    ]);
  });

  test("reattaches after the connection is lost and replaces the output with the new snapshot", async () => {
    const stream = openStream();

    await settle();

    const firstConnection = readConnection(0);

    firstConnection.send({ data: "before the drop\r\n", type: "snapshot" });
    firstConnection.close(1006);
    await settle();
    expect(readLastStatus()).toEqual(["disconnected", null]);
    stream.send({ data: "lost", type: "input" });

    await passTime(1_000);

    const secondConnection = readConnection(1);

    expect(secondConnection.url.href).toBe(firstConnection.url.href);
    expect(readLastStatus()).toEqual(["running", null]);
    expect(openCount).toBe(2);

    secondConnection.send({ data: "after the drop\r\n", type: "snapshot" });
    expect(terminalText).toBe("after the drop\r\n");

    stream.send({ data: "ls\r", type: "input" });
    expect(firstConnection.readSentFrames()).toEqual([]);
    expect(secondConnection.readSentFrames()).toEqual(['{"data":"ls\\r","type":"input"}']);
  });

  test("keeps trying while devhost is unreachable and stops once the session is no longer listed", async () => {
    openStream();
    await settle();

    fetchSessionList = failToFetch;
    webSocket.isRefusingConnections = true;
    readConnection(0).close(1006);
    await settle();
    await passTime(1_000);
    await passTime(2_000);
    expect(webSocket.attemptCount).toBe(3);
    expect(readLastStatus()).toEqual(["disconnected", null]);

    // Devhost is back without the session: the next attempt is turned away, and the list says why.
    fetchSessionList = listSessions([]);
    await passTime(4_000);
    expect(webSocket.attemptCount).toBe(4);
    expect(readLastStatus()).toEqual(["error", "This terminal session is no longer running."]);

    await passTime(60_000);
    expect(webSocket.attemptCount).toBe(4);
    expect(readLastStatus()).toEqual(["error", "This terminal session is no longer running."]);
  });

  test("ignores a session list that arrives after the stream reattached", async () => {
    const pendingLists: PendingSessionList[] = [];

    fetchSessionList = (): Promise<Response> => {
      const pendingList: PendingSessionList = Promise.withResolvers<Response>();

      pendingLists.push(pendingList);

      return pendingList.promise;
    };
    openStream();
    await settle();
    readConnection(0).close(1006);
    await settle();
    await passTime(1_000);
    expect(readLastStatus()).toEqual(["running", null]);

    const [pendingList] = pendingLists;

    assert(pendingList !== undefined);
    pendingList.resolve(Response.json({ sessions: [] }));
    await settle();

    expect(readLastStatus()).toEqual(["running", null]);
    readConnection(1).send({ data: "still attached", type: "output" });
    expect(terminalText).toBe("still attached");
  });

  test("reports that the session is no longer running when devhost ends it", async () => {
    openStream();
    await settle();

    // Devhost closes a session's connections normally when the session ends: another page closed it, or the stack
    // stopped.
    readConnection(0).close(1000);
    await settle();
    await passTime(60_000);

    expect(statusReports).toEqual([
      ["running", null],
      ["error", "This terminal session is no longer running."],
    ]);
    expect(webSocket.attemptCount).toBe(1);
  });

  test("stays finished when devhost ends the session after it exited", async () => {
    openStream();
    await settle();

    const connection = readConnection(0);

    connection.send({ exitCode: 0, signalCode: null, type: "exit" });
    connection.close(1000);
    await settle();

    expect(readLastStatus()).toEqual(["exited", null]);
  });

  test("stays finished when the connection is lost after the session exited", async () => {
    openStream();
    await settle();

    const connection = readConnection(0);

    connection.send({ exitCode: 0, signalCode: null, type: "exit" });
    connection.close(1006);
    await settle();
    await passTime(60_000);

    expect(readLastStatus()).toEqual(["exited", null]);
    expect(webSocket.attemptCount).toBe(1);
  });

  test("closes for good: no reports, no output, and no reattachment afterwards", async () => {
    const stream = openStream();

    await settle();

    const connection = readConnection(0);

    stream.close();
    // The socket is still closing, so output that was already on its way arrives now.
    connection.send({ data: "late", type: "output" });
    expect(connection.readClientClosure()).toEqual({ code: 1000, reason: "devtools unmounted" });

    connection.close(1006);
    await settle();
    await passTime(60_000);

    expect(terminalText).toBe("");
    expect(statusReports).toEqual([["running", null]]);
    expect(webSocket.attemptCount).toBe(1);
  });
});
