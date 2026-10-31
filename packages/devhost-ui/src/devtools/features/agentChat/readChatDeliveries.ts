import { nativeRecord, nativeString } from "./nativeValue";
import type { ChatDeliveryState, ChatHarnessId, IChatDeliveries, IChatEvent, IChatSendRecord } from "./types";

const DELIVERY_ORDER: readonly ChatDeliveryState[] = ["queued", "started", "completed"];

function advance(states: Map<string, ChatDeliveryState>, commandId: string, next: ChatDeliveryState): void {
  const current = states.get(commandId);
  if (current === undefined || DELIVERY_ORDER.indexOf(current) < DELIVERY_ORDER.indexOf(next)) {
    states.set(commandId, next);
  }
}

function finishStarted(states: Map<string, ChatDeliveryState>): void {
  for (const [commandId, state] of states) {
    if (state === "started") states.set(commandId, "completed");
  }
}

function readClaudeFrame(states: Map<string, ChatDeliveryState>, frame: Record<string, unknown>): void {
  if (frame.type === "result") {
    finishStarted(states);
    return;
  }
  if (frame.type === "user" && frame.isReplay === true) {
    advance(states, nativeString(frame.uuid), "started");
    return;
  }
  if (frame.type !== "command_lifecycle") return;
  const commandId = nativeString(frame.command_uuid);
  switch (frame.state) {
    case "queued":
    case "started":
    case "completed":
      advance(states, commandId, frame.state);
      break;
    case "cancelled":
      // Stopping a running turn cancels its message as well; that message did run.
      states.set(commandId, states.get(commandId) === "started" ? "completed" : "cancelled");
      break;
    case "refused":
    case "discarded":
      states.set(commandId, "failed");
      break;
  }
}

/**
 * Folds replayed native frames into what each sent message reached, so a reloaded page derives the same state a
 * live one saw. The native frames carry the browser's command ID. Claude Code reports `queued` directly; Codex has
 * no frame for it, and its interrupt discards pending input without naming it, so that is reported by sequence.
 */
export function readChatDeliveries(harness: ChatHarnessId, events: readonly IChatEvent[]): IChatDeliveries {
  const states = new Map<string, ChatDeliveryState>();
  let interruptedAt = 0;
  for (const event of events) {
    const frame = nativeRecord(event.payload);
    if (harness === "claude-code") {
      readClaudeFrame(states, frame);
    } else if (frame.method === "turn/completed") {
      finishStarted(states);
      if (nativeRecord(nativeRecord(frame.params).turn).status === "interrupted") interruptedAt = event.sequence;
    } else if (frame.method === "item/started") {
      const item = nativeRecord(nativeRecord(frame.params).item);
      if (item.type === "userMessage" && typeof item.clientId === "string") advance(states, item.clientId, "started");
    }
  }
  return { states, interruptedAt };
}

/** Combines a send's local state with native evidence, which is always newer than what the socket reported. */
export function readSendState(deliveries: IChatDeliveries, send: IChatSendRecord): ChatDeliveryState {
  const native = deliveries.states.get(send.commandId);
  if (native !== undefined) return native;
  if ((send.state === "queued" || send.state === "unconfirmed") && deliveries.interruptedAt > send.afterSequence) {
    return "cancelled";
  }
  return send.state;
}
