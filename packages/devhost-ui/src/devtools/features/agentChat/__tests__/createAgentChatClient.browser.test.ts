import { waitFor } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { installMockWebSocket, type IInstalledMockWebSocket } from "../../../../../test-support/installMockWebSocket";
import type { IMockWebSocketConnection } from "../../../../../test-support/createMockWebSocket";
import { createAgentChatClient } from "../createAgentChatClient";
import type { IAgentChatClient, IChatSession } from "../types";

let sockets: IInstalledMockWebSocket;
let client: IAgentChatClient;
const session: IChatSession = { id: "accepted-session", harness: "codex", projectRootPath: "/project", status: "idle" };

beforeEach(() => {
  sockets = installMockWebSocket();
  client = createAgentChatClient("https://app.localhost/page", window.location);
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

test("rejects unconfirmed sends on disconnect without replaying them after reconnect", async () => {
  const connection = await attachSession();
  vi.useFakeTimers();
  const failure = client.send({ text: "Review this" }, "Review this").catch((error: unknown) => error);
  connection.close(1006);
  expect(await failure).toEqual(
    new Error("Connection lost before confirming your message. Check the conversation before retrying."),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sockets.connections).toHaveLength(2);
  const reconnected = sockets.connections[1];
  assert(reconnected);
  reconnected.send({ type: "snapshot", sessionId: session.id, session, events: [], pendingRequestIds: [] });
  expect(reconnected.readSentFrames()).toEqual([]);
});

test("times out a missing send acknowledgement and releases the pending command", async () => {
  const connection = await attachSession();
  vi.useFakeTimers();
  const rejected = vi.fn();
  const result = client.send({ text: "Review this" }, "Review this").catch(rejected);
  const sent = z.object({ commandId: z.string() }).parse(JSON.parse(String(connection.readSentFrames()[0])));
  await vi.advanceTimersByTimeAsync(44_999);
  expect(rejected).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect(rejected).toHaveBeenCalledWith(
    new Error("Your message was not confirmed. Check the conversation before retrying."),
  );
  connection.send({ type: "command_result", sessionId: session.id, commandId: sent.commandId });
  expect(rejected).toHaveBeenCalledOnce();
});
