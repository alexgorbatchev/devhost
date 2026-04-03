import type { ITerminalSession } from "./types";

export function shouldAutoRemoveTerminalSession(session: ITerminalSession, hasExited: boolean): boolean {
  return hasExited && session.kind === "component-source";
}
