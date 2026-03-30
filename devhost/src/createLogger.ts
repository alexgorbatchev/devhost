export interface IDevhostLogger {
  info: (message: string, ...arguments_: unknown[]) => void;
  error: (message: string, ...arguments_: unknown[]) => void;
}

interface ICreateLoggerOptions {
  infoSink: (message: string, ...arguments_: unknown[]) => void;
  errorSink: (message: string, ...arguments_: unknown[]) => void;
}

const logPrefix: string = "[devhost]";

export function createLogger(options: ICreateLoggerOptions): IDevhostLogger {
  return {
    error(message: string, ...arguments_: unknown[]): void {
      writePrefixedMessage(message, arguments_, options.errorSink);
    },
    info(message: string, ...arguments_: unknown[]): void {
      writePrefixedMessage(message, arguments_, options.infoSink);
    },
  };
}

function writePrefixedMessage(
  message: string,
  arguments_: unknown[],
  sink: (message: string, ...arguments_: unknown[]) => void,
): void {
  const lines: string[] = splitLines(message);

  lines.forEach((line: string, index: number): void => {
    sink(`${logPrefix} ${line}`.trimEnd(), ...(index === 0 ? arguments_ : []));
  });
}

function splitLines(message: string): string[] {
  return message.replaceAll("\r\n", "\n").split("\n");
}
