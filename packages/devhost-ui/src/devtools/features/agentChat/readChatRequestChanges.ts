import type { IChatEvent, IChatPendingRequest } from "./types";
import { nativeArray, nativeRecord, nativeString } from "./nativeValue";

export interface IChatRequestChange {
  path: string;
  diff: string;
}
export function readChatRequestChanges(
  request: IChatPendingRequest,
  events: readonly IChatEvent[],
): readonly IChatRequestChange[] {
  if (request.harness !== "codex" || request.method !== "item/fileChange/requestApproval") return [];
  const requested = nativeRecord(nativeRecord(request.payload).params);
  const id = nativeString(requested.itemId);
  if (!id) return [];
  for (const event of [...events].sort((first, second) => second.sequence - first.sequence)) {
    const params = nativeRecord(nativeRecord(event.payload).params);
    if (params.threadId !== requested.threadId || params.turnId !== requested.turnId) continue;
    const item = nativeRecord(params.item);
    if (item.id !== id || item.type !== "fileChange") continue;
    return nativeArray(item.changes).flatMap((value) => {
      const change = nativeRecord(value);
      return typeof change.path === "string" && typeof change.diff === "string"
        ? [{ path: change.path, diff: change.diff }]
        : [];
    });
  }
  return [];
}
