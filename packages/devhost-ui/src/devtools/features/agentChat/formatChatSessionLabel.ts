import type { IChatSession } from "./types";

export function formatChatSessionLabel(session: IChatSession): string {
  return `${session.harness} · ${session.id}`;
}
