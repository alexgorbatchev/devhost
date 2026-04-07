import type { TerminalSession } from "./types";

export function shouldAutoRemoveTerminalSession(session: TerminalSession, hasExited: boolean): boolean {
  return hasExited && session.behavior.shouldAutoRemoveOnExit;
}
