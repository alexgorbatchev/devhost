import type { ChatHarnessId, ChatRequestId, IChatEvent, IChatPendingRequest, IChatProjection } from "./types";
import { nativeArray, nativeRecord, nativeString } from "./nativeValue";
import { projectCodexEvents } from "./projectCodexEvents";
import { projectClaudeEvents } from "./projectClaudeEvents";

export function projectChatEvents(
  harness: ChatHarnessId,
  inputEvents: readonly IChatEvent[],
  pendingRequestIds: readonly ChatRequestId[],
): IChatProjection {
  const events = [...new Map(inputEvents.map((event) => [event.sequence, event])).values()].sort(
    (first, second) => first.sequence - second.sequence,
  );
  const pending = new Set(pendingRequestIds);
  const requests = new Map<ChatRequestId, IChatPendingRequest>();
  for (const event of events) {
    const frame = nativeRecord(event.payload);
    const response = nativeRecord(frame.response);
    const inherited =
      harness === "claude-code" && frame.type === "control_response"
        ? [...nativeArray(response.pending_permission_requests), ...nativeArray(response.pending_user_dialog_requests)]
        : [];
    for (const payload of [event.payload, ...inherited]) {
      const request = nativeRecord(payload);
      const id = harness === "codex" ? request.id : request.request_id;
      const method =
        harness === "codex" ? nativeString(request.method) : nativeString(nativeRecord(request.request).subtype);
      if (
        (typeof id === "string" || typeof id === "number") &&
        pending.has(id) &&
        method &&
        (harness === "codex" || request.type === "control_request")
      )
        requests.set(id, { requestId: id, harness, method, payload });
    }
  }
  const messages = harness === "codex" ? projectCodexEvents(events) : projectClaudeEvents(events);
  return { messages, pendingRequests: [...requests.values()], events };
}
