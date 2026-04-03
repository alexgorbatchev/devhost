import { createTerminalSessionEnvironment } from "./createTerminalSessionEnvironment";

interface ILaunchTerminalSessionOptions {
  cleanup?: () => void;
  cols: number;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  onData: (data: Uint8Array) => void;
  rows: number;
}

export interface ILaunchedTerminalSession {
  childProcess: Bun.Subprocess;
  cleanup: () => void;
  close: () => void;
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
}

export function launchTerminalSession(options: ILaunchTerminalSessionOptions): ILaunchedTerminalSession {
  const childProcess = Bun.spawn(options.command, {
    cwd: options.cwd,
    env: createTerminalSessionEnvironment({
      ...process.env,
      ...options.env,
    }),
    terminal: {
      cols: options.cols,
      data: (_terminal: Bun.Terminal, data: Uint8Array): void => {
        options.onData(data);
      },
      rows: options.rows,
    },
  });
  const terminal: Bun.Terminal | undefined = childProcess.terminal;

  if (terminal === undefined) {
    childProcess.kill();
    throw new Error("Failed to start terminal session: PTY was not created.");
  }

  return {
    childProcess,
    cleanup: options.cleanup ?? (() => {}),
    close: (): void => {
      terminal.close();

      if (childProcess.exitCode === null && !childProcess.killed) {
        childProcess.kill("SIGTERM");
      }
    },
    resize: (cols: number, rows: number): void => {
      terminal.resize(cols, rows);
    },
    write: (data: string): void => {
      terminal.write(data);
    },
  };
}
