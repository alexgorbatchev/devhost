import { managedCaddyPaths } from "./caddyPaths";

export type StdioMode = "inherit" | "pipe";

export interface ICaddyCommandResult {
  stderr: Uint8Array;
  stdout: Uint8Array;
  success: boolean;
}

export interface IRunManagedCaddyCommandOptions {
  stdioMode?: StdioMode;
}

export type ManagedCaddyCommandRunner = (
  arguments_: string[],
  options?: IRunManagedCaddyCommandOptions,
) => ICaddyCommandResult;

export function createManagedCaddyCommandArguments(arguments_: string[]): string[] {
  return [...arguments_, "--config", managedCaddyPaths.caddyfilePath, "--adapter", "caddyfile"];
}

export function runManagedCaddyCommand(
  arguments_: string[],
  options: IRunManagedCaddyCommandOptions = {},
): ICaddyCommandResult {
  const resolvedStdioMode: StdioMode = options.stdioMode ?? "pipe";
  const result = Bun.spawnSync(["caddy", ...createManagedCaddyCommandArguments(arguments_)], {
    cwd: managedCaddyPaths.caddyDirectoryPath,
    stderr: resolvedStdioMode,
    stdin: resolvedStdioMode === "inherit" ? "inherit" : undefined,
    stdout: resolvedStdioMode,
  });

  if (resolvedStdioMode === "inherit") {
    return {
      stderr: new Uint8Array(),
      stdout: new Uint8Array(),
      success: result.success,
    };
  }

  return {
    stderr: result.stderr ?? new Uint8Array(),
    stdout: result.stdout ?? new Uint8Array(),
    success: result.success,
  };
}

export function createManagedCaddyCommandErrorMessage(commandName: string, result: ICaddyCommandResult): string {
  const stderrText: string = decodeManagedCaddyCommandOutput(result.stderr);
  const stdoutText: string = decodeManagedCaddyCommandOutput(result.stdout);
  const combinedOutput: string = [stderrText, stdoutText].filter((text: string): boolean => text.length > 0).join("\n");

  if (combinedOutput.length === 0) {
    return `Caddy ${commandName} failed.`;
  }

  return `Caddy ${commandName} failed.\n${combinedOutput}`;
}

function decodeManagedCaddyCommandOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}
