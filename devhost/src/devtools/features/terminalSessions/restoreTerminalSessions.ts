import { createTerminalSession } from "./createTerminalSession";
import { appendTerminalSession } from "./manageTerminalSessions";
import type { IActiveTerminalSessionSnapshot, TerminalSession } from "./types";

export function restoreTerminalSessions(
  currentSessions: TerminalSession[],
  restoredSessionSnapshots: IActiveTerminalSessionSnapshot[],
  agentDisplayName: string,
): TerminalSession[] {
  const currentSessionIds = new Set<string>(
    currentSessions.map((terminalSession: TerminalSession): string => terminalSession.sessionId),
  );
  const restoredSessions: TerminalSession[] = restoredSessionSnapshots.reduce(
    (
      restoredTerminalSessions: TerminalSession[],
      restoredSessionSnapshot: IActiveTerminalSessionSnapshot,
    ): TerminalSession[] => {
      if (currentSessionIds.has(restoredSessionSnapshot.sessionId)) {
        return restoredTerminalSessions;
      }

      return appendTerminalSession(
        restoredTerminalSessions,
        createTerminalSession(restoredSessionSnapshot.sessionId, restoredSessionSnapshot.request, agentDisplayName),
      );
    },
    [],
  );
  const hasExpandedCurrentSession: boolean = currentSessions.some((terminalSession: TerminalSession): boolean => {
    return terminalSession.isExpanded;
  });
  const normalizedRestoredSessions: TerminalSession[] = hasExpandedCurrentSession
    ? restoredSessions.map((terminalSession: TerminalSession): TerminalSession => {
        return {
          ...terminalSession,
          isExpanded: false,
        };
      })
    : restoredSessions;

  return [...currentSessions, ...normalizedRestoredSessions];
}
