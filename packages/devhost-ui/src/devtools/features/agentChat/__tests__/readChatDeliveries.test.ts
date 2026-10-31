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

const cases: ReadonlyArray<[string, ChatHarnessId, readonly unknown[], ChatDeliveryState | undefined]> = [
  ["queued mid-turn", "claude-code", [lifecycle("a", "queued")], "queued"],
  ["picked up", "claude-code", [lifecycle("a", "queued"), lifecycle("a", "started")], "started"],
  ["echo without lifecycle frames", "claude-code", [echo("a")], "started"],
  [
    "a late started frame never goes back",
    "claude-code",
    [lifecycle("a", "completed"), lifecycle("a", "started")],
    "completed",
  ],
  ["completed", "claude-code", [lifecycle("a", "started"), lifecycle("a", "completed")], "completed"],
  ["result finishes an echoed message", "claude-code", [echo("a"), result], "completed"],
  ["result leaves a queued message queued", "claude-code", [lifecycle("a", "queued"), result], "queued"],
  ["stopped before pickup", "claude-code", [lifecycle("a", "queued"), lifecycle("a", "cancelled")], "cancelled"],
  ["stopped while running ran", "claude-code", [lifecycle("a", "started"), lifecycle("a", "cancelled")], "completed"],
  ["refused", "claude-code", [lifecycle("a", "refused")], "failed"],
  ["discarded", "claude-code", [lifecycle("a", "queued"), lifecycle("a", "discarded")], "failed"],
  ["unknown lifecycle state", "claude-code", [lifecycle("a", "future")], undefined],
  ["picked up by Codex", "codex", [userMessage("a")], "started"],
  ["finished by Codex", "codex", [userMessage("a"), turnEnded("completed")], "completed"],
  ["a user message without a client ID", "codex", [userMessage("")], undefined],
];

for (const [name, harness, payloads, expected] of cases) {
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
