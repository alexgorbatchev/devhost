import { appendTerminalSession } from "./manageTerminalSessions";
import type { TerminalSession } from "./types";

export function appendStartedTerminalSessionIfNeeded(
  currentSessions: TerminalSession[],
  nextSession: TerminalSession,
): TerminalSession[] {
  return currentSessions.some((session: TerminalSession): boolean => session.sessionId === nextSession.sessionId)
    ? currentSessions
    : appendTerminalSession(currentSessions, nextSession);
}
