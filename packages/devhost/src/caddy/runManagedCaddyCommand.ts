import { existsSync } from "node:fs";
import { join } from "node:path";
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

export type ExistsSyncImplementation = (path: string) => boolean;

export function resolveCaddyExecutablePath(
  existsSyncImplementation: ExistsSyncImplementation = existsSync,
  osOverride: string = process.platform,
): string {
  const extension = osOverride === "win32" ? ".exe" : "";
  const isolatedPath = join(managedCaddyPaths.caddyDirectoryPath, `caddy${extension}`);

  if (existsSyncImplementation(isolatedPath)) {
    return isolatedPath;
  }

  return "caddy";
}

export interface IRunManagedCaddyCommandDependencies {
  existsSync?: ExistsSyncImplementation;
}

export function runManagedCaddyCommand(
  arguments_: string[],
  options: IRunManagedCaddyCommandOptions = {},
  dependencies: IRunManagedCaddyCommandDependencies = {},
): ICaddyCommandResult {
  const resolvedStdioMode: StdioMode = options.stdioMode ?? "pipe";
  const executable: string = resolveCaddyExecutablePath(dependencies.existsSync);
  const result = Bun.spawnSync([executable, ...createManagedCaddyCommandArguments(arguments_)], {
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
