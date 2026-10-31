import { waitFor } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { installMockWebSocket, type IInstalledMockWebSocket } from "../../../../../test-support/installMockWebSocket";
import type { IMockWebSocketConnection } from "../../../../../test-support/createMockWebSocket";
import { createAgentChatClient } from "../createAgentChatClient";
import type { IAgentChatClient, IChatSession } from "../types";
import { createDevtoolsSettingsStore } from "../../../shared/createDevtoolsSettingsStore";

let sockets: IInstalledMockWebSocket;
let client: IAgentChatClient;
const session: IChatSession = { id: "accepted-session", harness: "codex", projectRootPath: "/project", status: "idle" };

beforeEach(() => {
  sockets = installMockWebSocket();
  const storage = new Map<string, string>();
  const settings = createDevtoolsSettingsStore(
    { projectRootPath: "/project", pageURL: "https://app.localhost/page" },
    () => ({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: (key) => {
        storage.delete(key);
      },
    }),
  );
  client = createAgentChatClient("https://app.localhost/page", "project", window.location, settings);
});
afterEach(async () => {
  client.dispose();
  await Promise.resolve();
  sockets.restore();
  vi.useRealTimers();
});

async function attachSession(): Promise<IMockWebSocketConnection> {
  const resumed = client.resumeSession(session);
  await waitFor(() => expect(sockets.connections).toHaveLength(1));
  const connection = sockets.connections[0];
  assert(connection);
  connection.send({ type: "snapshot", sessionId: session.id, session, events: [], pendingRequestIds: [] });
  await resumed;
  return connection;
}

test("waits for the matching server acknowledgement and does not accept stale acknowledgements", async () => {
  const connection = await attachSession();
  const accepted = vi.fn();
  const result = client.send({ text: "Review this" }, "Review this").then(accepted);
  const sent = z.object({ commandId: z.string() }).parse(JSON.parse(String(connection.readSentFrames()[0])));
  connection.send({ type: "command_result", sessionId: session.id, commandId: "different-send" });
  await Promise.resolve();
  expect(accepted).not.toHaveBeenCalled();
  connection.send({ type: "command_result", sessionId: "different-session", commandId: sent.commandId });
  await Promise.resolve();
  expect(accepted).not.toHaveBeenCalled();
  connection.send({ type: "command_result", sessionId: session.id, commandId: sent.commandId });
  await result;
  expect(accepted).toHaveBeenCalledOnce();
});

test("a send the connection lost is unconfirmed and is not replayed after reconnect", async () => {
  const connection = await attachSession();
  vi.useFakeTimers();
  const receipt = client.send({ text: "Review this" }, "Review this");
  connection.close(1006);
  await expect(receipt).resolves.toMatchObject({ sessionId: session.id });
  expect(client.getSnapshot().lastSend?.state).toBe("unconfirmed");
  expect(client.getSnapshot().sendError).toBeNull();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sockets.connections).toHaveLength(2);
  const reconnected = sockets.connections[1];
  assert(reconnected);
  reconnected.send({ type: "snapshot", sessionId: session.id, session, events: [], pendingRequestIds: [] });
  expect(reconnected.readSentFrames()).toEqual([]);
});

test("a missing send acknowledgement becomes unconfirmed and releases the pending command", async () => {
  const connection = await attachSession();
  vi.useFakeTimers();
  const settled = vi.fn();
  const result = client.send({ text: "Review this" }, "Review this").then(settled);
  const sent = z.object({ commandId: z.string() }).parse(JSON.parse(String(connection.readSentFrames()[0])));
  await vi.advanceTimersByTimeAsync(44_999);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect(settled).toHaveBeenCalledOnce();
  expect(client.getSnapshot().lastSend).toMatchObject({ commandId: sent.commandId, state: "unconfirmed" });
  connection.send({ type: "command_result", sessionId: session.id, commandId: sent.commandId, delivery: "queued" });
  expect(client.getSnapshot().lastSend?.state).toBe("unconfirmed");
});

test("records the delivery the server reports", async () => {
  const connection = await attachSession();
  const receipt = client.send({ text: "Review this" }, "Review this");
  expect(client.getSnapshot().lastSend?.state).toBe("sending");
  const sent = z.object({ commandId: z.string() }).parse(JSON.parse(String(connection.readSentFrames()[0])));
  connection.send({ type: "command_result", sessionId: session.id, commandId: sent.commandId, delivery: "queued" });
  await expect(receipt).resolves.toEqual({ sessionId: session.id, commandId: sent.commandId });
  expect(client.getSnapshot().lastSend?.state).toBe("queued");
});

test("a definite failure rejects and records the failure", async () => {
  const connection = await attachSession();
  const receipt = client.send({ text: "Review this" }, "Review this");
  const sent = z.object({ commandId: z.string() }).parse(JSON.parse(String(connection.readSentFrames()[0])));
  connection.send({ type: "command_result", sessionId: session.id, commandId: sent.commandId, error: "Refused" });
  await expect(receipt).rejects.toThrow("Refused");
  expect(client.getSnapshot().lastSend?.state).toBe("failed");
});

test("a message that could not be written is a definite failure", async () => {
  const connection = await attachSession();
  connection.close(1000);
  await waitFor(() => expect(client.getSnapshot().isConnected).toBe(false));
  await expect(client.send({ text: "Review this" }, "Review this")).rejects.toThrow("disconnected");
  expect(client.getSnapshot().lastSend?.state).toBe("failed");
});
