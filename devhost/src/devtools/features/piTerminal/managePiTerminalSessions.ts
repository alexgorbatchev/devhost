import type { IPiTerminalSession } from "./types";

export function appendPiTerminalSession(
  currentSessions: IPiTerminalSession[],
  nextSession: IPiTerminalSession,
): IPiTerminalSession[] {
  return [nextSession, ...currentSessions];
}

export function expandPiTerminalSession(
  currentSessions: IPiTerminalSession[],
  targetSessionId: string,
): IPiTerminalSession[] {
  const hasTargetSession: boolean = currentSessions.some((session: IPiTerminalSession): boolean => {
    return session.sessionId === targetSessionId;
  });

  if (!hasTargetSession) {
    return currentSessions;
  }

  return currentSessions.map((session: IPiTerminalSession): IPiTerminalSession => {
    return {
      ...session,
      isExpanded: session.sessionId === targetSessionId,
    };
  });
}

export function minimizePiTerminalSession(
  currentSessions: IPiTerminalSession[],
  targetSessionId: string,
): IPiTerminalSession[] {
  return currentSessions.map((session: IPiTerminalSession): IPiTerminalSession => {
    if (session.sessionId !== targetSessionId) {
      return session;
    }

    return {
      ...session,
      isExpanded: false,
    };
  });
}

export function removePiTerminalSession(
  currentSessions: IPiTerminalSession[],
  targetSessionId: string,
): IPiTerminalSession[] {
  return currentSessions.filter((session: IPiTerminalSession): boolean => session.sessionId !== targetSessionId);
}
