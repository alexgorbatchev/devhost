import type { ITerminalSession } from "./types";

export function shouldAutoRemoveTerminalSession(session: ITerminalSession, hasExited: boolean): boolean {
  return hasExited && session.behavior.shouldAutoRemoveOnExit;
}
