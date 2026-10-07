import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, test, vi } from "vitest";

import type { IMockWebSocketConnection } from "../../../../../../test-support/createMockWebSocket";
import {
  installMockWebSocket,
  type IInstalledMockWebSocket,
} from "../../../../../../test-support/installMockWebSocket";
import { maximumRetainedLogEntries } from "../../../../shared/constants";
import type { ServiceLogEntry } from "../../../../shared/types";
import { useServiceLogs } from "../useServiceLogs";

type ServerAction = () => void;

interface IServiceLogsProps {
  isPaused: boolean;
}

interface IConnectedServiceLogs {
  connection: IMockWebSocketConnection;
  hook: RenderHookResult<ServiceLogEntry[], IServiceLogsProps>;
}

let webSocket: IInstalledMockWebSocket;

function logEntry(id: number): ServiceLogEntry {
  return { id, line: `line ${id}`, serviceName: "api", stream: "stdout" };
}

function logEntries(firstId: number, count: number): ServiceLogEntry[] {
  return Array.from({ length: count }, (_value: unknown, index: number): ServiceLogEntry => logEntry(firstId + index));
}

function readEntryIds(hook: IConnectedServiceLogs["hook"]): number[] {
  return hook.result.current.map((entry: ServiceLogEntry): number => entry.id);
}

// Lets the socket's queued open or close run, and applies the state updates a server action causes.
async function settle(action?: ServerAction): Promise<void> {
  await act(async (): Promise<void> => {
    action?.();
  });
}

async function connectServiceLogs(isPaused: boolean = false): Promise<IConnectedServiceLogs> {
  const hook = renderHook((props: IServiceLogsProps): ServiceLogEntry[] => useServiceLogs(props.isPaused), {
    initialProps: { isPaused },
  });

  await settle();

  const connection: IMockWebSocketConnection | undefined = webSocket.connections.at(0);

  assert(connection !== undefined);

  return { connection, hook };
}

beforeEach(() => {
  webSocket = installMockWebSocket();
});

afterEach(() => {
  vi.useRealTimers();
  webSocket.restore();
});

describe("useServiceLogs", () => {
  test("opens one logs stream on the current host and starts empty", async () => {
    const { connection, hook } = await connectServiceLogs();

    expect(connection.url.href).toBe(`ws://${window.location.host}/__devhost__/ws/logs`);
    expect(hook.result.current).toEqual([]);

    hook.rerender({ isPaused: false });
    await settle();
    expect(webSocket.connections).toHaveLength(1);
  });

  test("replaces its entries with each snapshot and appends single entries", async () => {
    const { connection, hook } = await connectServiceLogs();

    await settle(() => connection.send({ entries: [logEntry(1), logEntry(2)], type: "snapshot" }));
    expect(hook.result.current).toEqual([logEntry(1), logEntry(2)]);

    await settle(() => connection.send({ entry: logEntry(3), type: "entry" }));
    expect(hook.result.current).toEqual([logEntry(1), logEntry(2), logEntry(3)]);

    await settle(() => connection.send({ entries: [logEntry(9)], type: "snapshot" }));
    expect(hook.result.current).toEqual([logEntry(9)]);
  });

  test("keeps only the newest entries once the retention limit is passed", async () => {
    const { connection, hook } = await connectServiceLogs();
    const lastSnapshotId: number = maximumRetainedLogEntries + 2;

    await settle(() => connection.send({ entries: logEntries(1, lastSnapshotId), type: "snapshot" }));
    expect(hook.result.current).toHaveLength(maximumRetainedLogEntries);
    expect(readEntryIds(hook).at(0)).toBe(3);
    expect(readEntryIds(hook).at(-1)).toBe(lastSnapshotId);

    await settle(() => connection.send({ entry: logEntry(lastSnapshotId + 1), type: "entry" }));
    expect(hook.result.current).toHaveLength(maximumRetainedLogEntries);
    expect(readEntryIds(hook).at(0)).toBe(4);
    expect(readEntryIds(hook).at(-1)).toBe(lastSnapshotId + 1);
  });

  test("holds entries that arrive while paused and shows them all on resume", async () => {
    const { connection, hook } = await connectServiceLogs();

    await settle(() => connection.send({ entries: [logEntry(1)], type: "snapshot" }));
    hook.rerender({ isPaused: true });

    await settle(() => connection.send({ entry: logEntry(2), type: "entry" }));
    await settle(() => connection.send({ entry: logEntry(3), type: "entry" }));
    expect(readEntryIds(hook)).toEqual([1]);

    hook.rerender({ isPaused: false });
    expect(readEntryIds(hook)).toEqual([1, 2, 3]);

    await settle(() => connection.send({ entry: logEntry(4), type: "entry" }));
    expect(readEntryIds(hook)).toEqual([1, 2, 3, 4]);
  });

  test("holds a snapshot that arrives while paused and builds on it", async () => {
    const { connection, hook } = await connectServiceLogs(true);

    await settle(() => connection.send({ entries: [logEntry(5), logEntry(6)], type: "snapshot" }));
    await settle(() => connection.send({ entry: logEntry(7), type: "entry" }));
    expect(readEntryIds(hook)).toEqual([]);

    hook.rerender({ isPaused: false });
    expect(readEntryIds(hook)).toEqual([5, 6, 7]);
  });

  test("ignores frames that are not log messages", async () => {
    const { connection, hook } = await connectServiceLogs();

    await settle(() => connection.send({ entries: [logEntry(1)], type: "snapshot" }));
    await settle(() => {
      connection.sendFrame(new ArrayBuffer(1));
      connection.sendFrame("{");
      connection.send({ type: "other" });
      connection.send({ entries: [{ id: "1" }], type: "snapshot" });
      connection.send({ entry: { ...logEntry(2), stream: "stdin" }, type: "entry" });
    });

    expect(hook.result.current).toEqual([logEntry(1)]);
  });

  test("keeps its entries while the stream is down and takes the snapshot of the reopened stream", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { connection, hook } = await connectServiceLogs();

    await settle(() => connection.send({ entries: [logEntry(1), logEntry(2)], type: "snapshot" }));
    await settle(() => connection.close(1006));
    expect(readEntryIds(hook)).toEqual([1, 2]);

    await settle(() => vi.advanceTimersByTime(1_000));

    const reopened: IMockWebSocketConnection | undefined = webSocket.connections.at(1);

    assert(reopened !== undefined);
    expect(reopened.url.href).toBe(connection.url.href);

    await settle(() => reopened.send({ entries: [logEntry(2), logEntry(3)], type: "snapshot" }));
    expect(readEntryIds(hook)).toEqual([2, 3]);
  });

  test("closes the stream when it unmounts", async () => {
    const { connection, hook } = await connectServiceLogs();

    expect(connection.readClientClosure()).toBeNull();

    hook.unmount();
    expect(connection.readClientClosure()).toEqual({ code: 1000, reason: "devtools unmounted" });
  });

  test("leaves a stream the server already closed alone when it unmounts", async () => {
    const { connection, hook } = await connectServiceLogs();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await settle(() => connection.close(1006));
    hook.unmount();
    await settle(() => vi.advanceTimersByTime(60_000));

    expect(connection.readClientClosure()).toBeNull();
    expect(webSocket.attemptCount).toBe(1);
  });
});
