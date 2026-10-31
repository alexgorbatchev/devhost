import type { ChatDeliveryReader, ChatDeliveryState, IChatReceipt, IChatSession } from "./types";

const SETTLED_STATES: readonly ChatDeliveryState[] = ["completed", "cancelled", "failed"];

/**
 * Whether a sent request is over. The end of a turn cannot decide this: after an interrupt a queued message starts
 * once the turn has ended. Without frames for the message, which older clients do not write, an idle session can.
 */
export function isChatRequestSettled(
  request: IChatReceipt,
  sessions: readonly IChatSession[],
  active: IChatSession | null,
  readDelivery: ChatDeliveryReader,
): boolean {
  const listed = active?.id === request.sessionId ? active : sessions.find((item) => item.id === request.sessionId);
  if (listed === undefined || listed.status === "closed" || listed.status === "error") return true;
  if (active?.id !== request.sessionId) return false;
  const state = readDelivery(request.commandId);
  return state === undefined ? active.status === "idle" : SETTLED_STATES.includes(state);
}
