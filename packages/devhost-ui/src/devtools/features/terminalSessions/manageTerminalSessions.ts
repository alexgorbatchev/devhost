import type { TerminalSession } from "./types";

export function appendTerminalSession(
  currentSessions: TerminalSession[],
  nextSession: TerminalSession,
): TerminalSession[] {
  const existingIndex = currentSessions.findIndex((s) => s.sessionId === nextSession.sessionId);
  let nextSessions = [...currentSessions];

  if (existingIndex !== -1) {
    nextSessions.splice(existingIndex, 1);
  }

  const normalizedCurrentSessions: TerminalSession[] = nextSession.isExpanded
    ? nextSessions.map((session: TerminalSession): TerminalSession => {
        return {
          ...session,
          isExpanded: false,
        };
      })
    : nextSessions;

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
