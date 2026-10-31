import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, test } from "vitest";
import { installMockWebSocket, type IInstalledMockWebSocket } from "../../../../test-support/installMockWebSocket";
import { useAgentActivity, type AgentActivityEvent } from "../useAgentActivity";

const STREAM_URL = "ws://127.0.0.1:4000/__devhost__/ws/agents/activity?chatTarget=project";
const event: AgentActivityEvent = { harness: "codex", pid: 1, eventType: "turn_start", timestamp: 1 };

let sockets: IInstalledMockWebSocket;

beforeEach(() => {
  sockets = installMockWebSocket();
});
afterEach(() => {
  sockets.restore();
});

test("connects to the stream and lists events newest first", async () => {
  const hook = renderHook(() => useAgentActivity(STREAM_URL));
  await waitFor(() => expect(hook.result.current.isConnected).toBe(true));
  const connection = sockets.connections[0];
  assert(connection);
  await act(async () => {
    connection.send(event);
    connection.send({ ...event, timestamp: 2 });
  });
  expect(hook.result.current.events.map((item) => item.timestamp)).toEqual([2, 1]);
  hook.unmount();
});

test("keeps a bounded history", async () => {
  const hook = renderHook(() => useAgentActivity(STREAM_URL));
  await waitFor(() => expect(hook.result.current.isConnected).toBe(true));
  const connection = sockets.connections[0];
  assert(connection);
  await act(async () => {
    for (let timestamp = 0; timestamp < 510; timestamp += 1) connection.send({ ...event, timestamp });
  });
  expect(hook.result.current.events).toHaveLength(500);
  expect(hook.result.current.events[0]?.timestamp).toBe(509);
  hook.unmount();
});

test("closing the page closes the stream, which stops the server's watcher", async () => {
  const hook = renderHook(() => useAgentActivity(STREAM_URL));
  await waitFor(() => expect(hook.result.current.isConnected).toBe(true));
  const connection = sockets.connections[0];
  assert(connection);
  hook.unmount();
  await waitFor(() => expect(connection.readClientClosure()).not.toBeNull());
});

test("reports a lost connection", async () => {
  const hook = renderHook(() => useAgentActivity(STREAM_URL));
  await waitFor(() => expect(hook.result.current.isConnected).toBe(true));
  await act(async () => {
    sockets.connections[0]?.close(1006);
  });
  expect(hook.result.current.isConnected).toBe(false);
  hook.unmount();
});
