import type { TerminalSession } from "./types";

export function appendTerminalSession(
  currentSessions: TerminalSession[],
  nextSession: TerminalSession,
): TerminalSession[] {
  const normalizedCurrentSessions: TerminalSession[] = nextSession.isExpanded
    ? currentSessions.map((session: TerminalSession): TerminalSession => {
        return {
          ...session,
          isExpanded: false,
        };
      })
    : currentSessions;

  return [nextSession, ...normalizedCurrentSessions];
}

export function expandTerminalSession(currentSessions: TerminalSession[], targetSessionId: string): TerminalSession[] {
  const hasTargetSession: boolean = currentSessions.some((session: TerminalSession): boolean => {
    return session.sessionId === targetSessionId;
  });

  if (!hasTargetSession) {
    return currentSessions;
  }

  return currentSessions.map((session: TerminalSession): TerminalSession => {
    return {
      ...session,
      isExpanded: session.sessionId === targetSessionId,
    };
  });
}

export function minimizeTerminalSession(
  currentSessions: TerminalSession[],
  targetSessionId: string,
): TerminalSession[] {
  return currentSessions.map((session: TerminalSession): TerminalSession => {
    if (session.sessionId !== targetSessionId) {
      return session;
    }

    return {
      ...session,
      isExpanded: false,
    };
  });
}

export function removeTerminalSession(currentSessions: TerminalSession[], targetSessionId: string): TerminalSession[] {
  return currentSessions.filter((session: TerminalSession): boolean => session.sessionId !== targetSessionId);
}
