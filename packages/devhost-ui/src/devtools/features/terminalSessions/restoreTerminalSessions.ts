import { createTerminalSession } from "./createTerminalSession";
import { appendTerminalSession } from "./manageTerminalSessions";
import type { ActiveTerminalSessionSnapshot, TerminalSession } from "./types";

export function restoreTerminalSessions(
  currentSessions: TerminalSession[],
  restoredSessionSnapshots: ActiveTerminalSessionSnapshot[],
): TerminalSession[] {
  const currentSessionIds = new Set<string>(
    currentSessions.map((terminalSession: TerminalSession): string => terminalSession.sessionId),
  );
  const restoredSessions: TerminalSession[] = restoredSessionSnapshots.reduce(
    (
      restoredTerminalSessions: TerminalSession[],
      restoredSessionSnapshot: ActiveTerminalSessionSnapshot,
    ): TerminalSession[] => {
      if (currentSessionIds.has(restoredSessionSnapshot.sessionId)) {
        return restoredTerminalSessions;
      }

      return appendTerminalSession(restoredTerminalSessions, createTerminalSession(restoredSessionSnapshot));
    },
    [],
  );
  const minimizedRestoredSessions: TerminalSession[] = restoredSessions.map(
    (terminalSession: TerminalSession): TerminalSession => {
      return {
        ...terminalSession,
        isExpanded: false,
      };
    },
  );

  return [...currentSessions, ...minimizedRestoredSessions];
}
