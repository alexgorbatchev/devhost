export type LogSinkFunction = (message: string, ...arguments_: unknown[]) => void;

export interface IDevhostLogger {
  info: LogSinkFunction;
  error: LogSinkFunction;
  withLabel: (label: string) => IDevhostLogger;
}

interface ICreateLoggerOptions {
  errorSink: LogSinkFunction;
  infoSink: LogSinkFunction;
  label?: string;
}

const defaultLabel: string = "devhost";

export function createLogger(options: ICreateLoggerOptions): IDevhostLogger {
  const resolvedLabel: string = resolveLabel(options.label);
  const logPrefix: string = `[${resolvedLabel}]`;

  return {
    error(message: string, ...arguments_: unknown[]): void {
      writePrefixedMessage(message, arguments_, logPrefix, options.errorSink);
    },
    info(message: string, ...arguments_: unknown[]): void {
      writePrefixedMessage(message, arguments_, logPrefix, options.infoSink);
    },
    withLabel(label: string): IDevhostLogger {
      return createLogger({
        errorSink: options.errorSink,
        infoSink: options.infoSink,
        label,
      });
    },
  };
}

function writePrefixedMessage(message: string, arguments_: unknown[], logPrefix: string, sink: LogSinkFunction): void {
  const lines: string[] = splitLines(message);

  lines.forEach((line: string, index: number): void => {
    sink(`${logPrefix} ${line}`.trimEnd(), ...(index === 0 ? arguments_ : []));
  });
}

function splitLines(message: string): string[] {
  return message.replaceAll("\r\n", "\n").split("\n");
}

function resolveLabel(label: string | undefined): string {
  if (label === undefined || label.trim().length === 0) {
    return defaultLabel;
  }

  return label;
}
