import { createPiTerminalSessionCommand } from "./createPiTerminalSessionCommand";
import { launchTerminalSession, type ILaunchedTerminalSession } from "./launchTerminalSession";

interface ILaunchPiTerminalSessionOptions {
  cols: number;
  cwd: string;
  onData: (data: Uint8Array) => void;
  prompt: string;
  rows: number;
}

export type { ILaunchedTerminalSession } from "./launchTerminalSession";

export function launchPiTerminalSession(options: ILaunchPiTerminalSessionOptions): ILaunchedTerminalSession {
  return launchTerminalSession({
    cols: options.cols,
    command: createPiTerminalSessionCommand(options.prompt),
    cwd: options.cwd,
    onData: options.onData,
    rows: options.rows,
  });
}
