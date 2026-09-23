import type { TerminalSession } from "./types";

/**
 * Chooses which session chips stay visible when the toolbar cannot fit them all: the expanded session first, then
 * live sessions, then exited ones; ties keep collection order (newest first). Visible chips keep collection order
 * so chip positions stay stable as the limit changes.
 */
export function pickVisibleTerminalSessions(sessions: TerminalSession[], limit: number): TerminalSession[] {
  if (limit >= sessions.length) {
    return sessions;
  }

  const keptSessionIds: Set<string> = new Set(
    sessions
      .map((session: TerminalSession, index: number) => ({ index, session }))
      .sort(
        (left, right) => readChipPriority(left.session) - readChipPriority(right.session) || left.index - right.index,
      )
      .slice(0, Math.max(0, limit))
      .map((entry) => entry.session.sessionId),
  );

  return sessions.filter((session: TerminalSession): boolean => keptSessionIds.has(session.sessionId));
}

function readChipPriority(session: TerminalSession): number {
  if (session.isExpanded) {
    return 0;
  }

  return session.status === "exited" ? 2 : 1;
}
