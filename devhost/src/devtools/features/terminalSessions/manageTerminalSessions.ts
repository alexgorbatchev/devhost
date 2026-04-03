import type { ITerminalSession } from "./types";

export function appendTerminalSession(
  currentSessions: ITerminalSession[],
  nextSession: ITerminalSession,
): ITerminalSession[] {
  const normalizedCurrentSessions: ITerminalSession[] = nextSession.isExpanded
    ? currentSessions.map((session: ITerminalSession): ITerminalSession => {
        return {
          ...session,
          isExpanded: false,
        };
      })
    : currentSessions;

  return [nextSession, ...normalizedCurrentSessions];
}

export function expandTerminalSession(
  currentSessions: ITerminalSession[],
  targetSessionId: string,
): ITerminalSession[] {
  const hasTargetSession: boolean = currentSessions.some((session: ITerminalSession): boolean => {
    return session.sessionId === targetSessionId;
  });

  if (!hasTargetSession) {
    return currentSessions;
  }

  return currentSessions.map((session: ITerminalSession): ITerminalSession => {
    return {
      ...session,
      isExpanded: session.sessionId === targetSessionId,
    };
  });
}

export function minimizeTerminalSession(
  currentSessions: ITerminalSession[],
  targetSessionId: string,
): ITerminalSession[] {
  return currentSessions.map((session: ITerminalSession): ITerminalSession => {
    if (session.sessionId !== targetSessionId) {
      return session;
    }

    return {
      ...session,
      isExpanded: false,
    };
  });
}

export function removeTerminalSession(
  currentSessions: ITerminalSession[],
  targetSessionId: string,
): ITerminalSession[] {
  return currentSessions.filter((session: ITerminalSession): boolean => session.sessionId !== targetSessionId);
}
