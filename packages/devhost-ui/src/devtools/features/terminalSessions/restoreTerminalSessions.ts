import type { IAnnotationAction } from "../../shared/devtoolsConfig";
import { createTerminalSession } from "./createTerminalSession";
import { appendTerminalSession } from "./manageTerminalSessions";
import type { IActiveTerminalSessionSnapshot, TerminalSession } from "./types";

export function restoreTerminalSessions(
  currentSessions: TerminalSession[],
  restoredSessionSnapshots: IActiveTerminalSessionSnapshot[],
  annotationActions: IAnnotationAction[],
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
        createTerminalSession(restoredSessionSnapshot.sessionId, restoredSessionSnapshot.request, annotationActions),
      );
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
