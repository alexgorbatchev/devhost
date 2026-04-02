interface ILaunchPiTerminalSessionOptions {
  cols: number;
  cwd: string;
  onData: (data: Uint8Array) => void;
  prompt: string;
  rows: number;
}

export interface ILaunchedPiTerminalSession {
  childProcess: Bun.Subprocess;
  close: () => void;
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
}

export function launchPiTerminalSession(options: ILaunchPiTerminalSessionOptions): ILaunchedPiTerminalSession {
  const childProcess = Bun.spawn(["pi", options.prompt], {
    cwd: options.cwd,
    env: process.env,
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
    throw new Error("Failed to start pi terminal session: PTY was not created.");
  }

  return {
    childProcess,
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
