import { expect, test } from "bun:test";
import { readChatDeliveries, readSendState } from "../readChatDeliveries";
import type { ChatDeliveryState, ChatHarnessId, IChatEvent } from "../types";

function events(...payloads: readonly unknown[]): readonly IChatEvent[] {
  return payloads.map((payload, index) => ({ sequence: index + 1, payload }));
}
function lifecycle(id: string, state: string): unknown {
  return { type: "command_lifecycle", command_uuid: id, state };
}
const echo = (id: string): unknown => ({ type: "user", isReplay: true, uuid: id });
const result: unknown = { type: "result", subtype: "success" };
const userMessage = (id: string): unknown => ({
  method: "item/started",
  params: { item: { type: "userMessage", id: "item", clientId: id } },
});
const turnEnded = (status: string): unknown => ({ method: "turn/completed", params: { turn: { id: "t", status } } });

interface IDeliveryCase {
  name: string;
  harness: ChatHarnessId;
  payloads: readonly unknown[];
  expected: ChatDeliveryState | undefined;
}

const cases: readonly IDeliveryCase[] = [
  { name: "queued mid-turn", harness: "claude-code", payloads: [lifecycle("a", "queued")], expected: "queued" },
  {
    name: "picked up",
    harness: "claude-code",
    payloads: [lifecycle("a", "queued"), lifecycle("a", "started")],
    expected: "started",
  },
  { name: "echo without lifecycle frames", harness: "claude-code", payloads: [echo("a")], expected: "started" },
  {
    name: "a late started frame never goes back",
    harness: "claude-code",
    payloads: [lifecycle("a", "completed"), lifecycle("a", "started")],
    expected: "completed",
  },
  {
    name: "completed",
    harness: "claude-code",
    payloads: [lifecycle("a", "started"), lifecycle("a", "completed")],
    expected: "completed",
  },
  {
    name: "result finishes an echoed message",
    harness: "claude-code",
    payloads: [echo("a"), result],
    expected: "completed",
  },
  {
    name: "result leaves a queued message queued",
    harness: "claude-code",
    payloads: [lifecycle("a", "queued"), result],
    expected: "queued",
  },
  {
    name: "stopped before pickup",
    harness: "claude-code",
    payloads: [lifecycle("a", "queued"), lifecycle("a", "cancelled")],
    expected: "cancelled",
  },
  {
    name: "stopped while running ran",
    harness: "claude-code",
    payloads: [lifecycle("a", "started"), lifecycle("a", "cancelled")],
    expected: "completed",
  },
  { name: "refused", harness: "claude-code", payloads: [lifecycle("a", "refused")], expected: "failed" },
  {
    name: "discarded",
    harness: "claude-code",
    payloads: [lifecycle("a", "queued"), lifecycle("a", "discarded")],
    expected: "failed",
  },
  {
    name: "unknown lifecycle state",
    harness: "claude-code",
    payloads: [lifecycle("a", "future")],
    expected: undefined,
  },
  { name: "picked up by Codex", harness: "codex", payloads: [userMessage("a")], expected: "started" },
  {
    name: "finished by Codex",
    harness: "codex",
    payloads: [userMessage("a"), turnEnded("completed")],
    expected: "completed",
  },
  { name: "a user message without a client ID", harness: "codex", payloads: [userMessage("")], expected: undefined },
];

for (const { name, harness, payloads, expected } of cases) {
  test(name, () => {
    expect(readChatDeliveries(harness, events(...payloads)).states.get("a")).toBe(expected);
  });
}

test("a Codex interrupt cancels what was queued before it", () => {
  const deliveries = readChatDeliveries("codex", events(turnEnded("completed"), turnEnded("interrupted")));
  expect(readSendState(deliveries, { commandId: "a", state: "queued", afterSequence: 1 })).toBe("cancelled");
  expect(readSendState(deliveries, { commandId: "a", state: "unconfirmed", afterSequence: 1 })).toBe("cancelled");
});

test("a Codex interrupt leaves what was sent after it", () => {
  const deliveries = readChatDeliveries("codex", events(turnEnded("interrupted")));
  expect(readSendState(deliveries, { commandId: "a", state: "queued", afterSequence: 1 })).toBe("queued");
});

test("native evidence overrides the state the socket reported", () => {
  const deliveries = readChatDeliveries("claude-code", events(lifecycle("a", "started")));
  expect(readSendState(deliveries, { commandId: "a", state: "unconfirmed", afterSequence: 0 })).toBe("started");
});
