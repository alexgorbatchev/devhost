import { waitFor } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { installMockWebSocket, type IInstalledMockWebSocket } from "../../../../../test-support/installMockWebSocket";
import type { IMockWebSocketConnection } from "../../../../../test-support/createMockWebSocket";
import { installMockFetch, type IInstalledMockFetch } from "../../../../../test-support/installMockFetch";
import {
  answerAgentList,
  answerChatSessions,
  failAgentList,
  readNewest,
} from "../../../../../test-support/routeChatRequests";
import { createAgentChatClient } from "../createAgentChatClient";
import type { IAgentChatClient, IChatSession } from "../types";
import { createDevtoolsSettingsStore } from "../../../shared/createDevtoolsSettingsStore";

let sockets: IInstalledMockWebSocket;
let client: IAgentChatClient;
let network: IInstalledMockFetch;
const session: IChatSession = { id: "accepted-session", harness: "codex", projectRootPath: "/project", status: "idle" };

beforeEach(() => {
  sockets = installMockWebSocket();
  network = installMockFetch();
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
  network.restore();
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

const startedSession: IChatSession = { ...session, id: "started-session" };

function serveChat(sessions: readonly IChatSession[], agents: readonly unknown[] = []): void {
  network.fetch.mockImplementation(answerAgentList(answerChatSessions(sessions, startedSession), agents));
}

function connectNextSession(connected: IChatSession): void {
  void waitFor(() => {
    readNewest(sockets.connections).send({
      type: "snapshot",
      sessionId: connected.id,
      session: connected,
      events: [],
      pendingRequestIds: [],
    });
  });
}

test("joining with nothing running leaves the send to start a session", async () => {
  serveChat([]);
  await client.joinRunningSession();
  expect(client.getSnapshot().session).toBeNull();
  expect(client.getSnapshot().joinedSession).toBeNull();
});

test("joining ignores sessions that have stopped", async () => {
  serveChat([
    { ...session, status: "closed" },
    { ...session, id: "failed", status: "error" },
  ]);
  await client.joinRunningSession();
  expect(client.getSnapshot().decision).toBeNull();
  expect(client.getSnapshot().joinedSession).toBeNull();
});

test("joining attaches the one running session and names it", async () => {
  serveChat([session]);
  connectNextSession(session);
  await client.joinRunningSession();
  expect(client.getSnapshot().session?.id).toBe(session.id);
  expect(client.getSnapshot().joinedSession?.id).toBe(session.id);
});

test("joining the attached session opens no second connection", async () => {
  await attachSession();
  serveChat([session]);
  await client.joinRunningSession();
  expect(sockets.connections).toHaveLength(1);
});

test("joining asks when several run, and a cancel sends nothing", async () => {
  const other: IChatSession = { ...session, id: "other" };
  serveChat([session, other]);
  const joined = client.joinRunningSession();
  await waitFor(() => expect(client.getSnapshot().decision?.kind).toBe("sessions"));
  client.decide({ kind: "cancel" });
  await expect(joined).rejects.toThrow("The request was not sent.");
  expect(client.getSnapshot().decision).toBeNull();
  expect(sockets.connections).toHaveLength(0);
});

test("starting asks about a working agent devhost did not start", async () => {
  serveChat([], [{ key: "k", harness: "codex", state: "working", subdirectory: ".", lastActivity: 1, isOwned: false }]);
  const started = client.newSession();
  await waitFor(() => expect(client.getSnapshot().decision?.kind).toBe("agents"));
  client.decide({ kind: "cancel" });
  await expect(started).rejects.toThrow("No conversation was started.");
});

test("starting does not ask when devhost already runs a session here", async () => {
  serveChat(
    [],
    [
      { key: "a", harness: "codex", state: "working", subdirectory: ".", lastActivity: 1, isOwned: true },
      { key: "b", harness: "codex", state: "working", subdirectory: ".", lastActivity: 1, isOwned: false },
    ],
  );
  const started = client.newSession();
  connectNextSession(startedSession);
  await started;
  expect(client.getSnapshot().decision).toBeNull();
});

test("a failed agent scan does not stop a chat from starting", async () => {
  network.fetch.mockImplementation(failAgentList(answerChatSessions([], startedSession)));
  const started = client.newSession();
  connectNextSession(startedSession);
  await started;
  expect(client.getSnapshot().session?.id).toBe("started-session");
});

test("disposing answers a pending decision", async () => {
  serveChat([session, { ...session, id: "other" }]);
  const joined = client.joinRunningSession();
  await waitFor(() => expect(client.getSnapshot().decision?.kind).toBe("sessions"));
  client.dispose();
  await expect(joined).rejects.toThrow("The request was not sent.");
});
