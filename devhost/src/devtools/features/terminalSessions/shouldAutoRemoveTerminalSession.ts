import { readTerminalSessionKindConfig } from "./readTerminalSessionKindConfig";
import type { ITerminalSession } from "./types";

export function shouldAutoRemoveTerminalSession(session: ITerminalSession, hasExited: boolean): boolean {
  return hasExited && readTerminalSessionKindConfig(session.kind).shouldAutoRemoveOnExit;
}
