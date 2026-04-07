import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { managedCaddyPaths, type IManagedCaddyPaths } from "./caddyPaths";
import { ensureManagedCaddyConfig } from "./ensureManagedCaddyConfig";
import { runManagedCaddyLifecycleCommand } from "./runManagedCaddyLifecycleCommand";
import type { IDevhostLogger } from "../utils/createLogger";

export interface IManagedCaddyAutostopSession {
  release: () => Promise<void>;
}

export interface ICreateManagedCaddyAutostopSessionOptions {
  manifestPath: string;
  stackName: string;
}

interface IManagedCaddyAutostopOwner {
  createdAt: string;
  manifestPath: string;
  ownerPid: number;
  stackName: string;
}

interface IManagedRouteRegistration {
  host: string;
  ownerPid: number;
  port: number;
}

type EnsureManagedCaddyConfigFunction = (paths: IManagedCaddyPaths) => Promise<void>;
type IsProcessAliveFunction = (processId: number) => boolean;
type ManagedCaddyLifecycleCommandFunction = (action: "start" | "stop", logger: IDevhostLogger) => Promise<number>;

interface ICreateManagedCaddyAutostopSessionDependencies {
  ensureManagedCaddyConfig?: EnsureManagedCaddyConfigFunction;
  isProcessAlive?: IsProcessAliveFunction;
  paths?: IManagedCaddyPaths;
  runManagedCaddyLifecycleCommand?: ManagedCaddyLifecycleCommandFunction;
}

const lockRetryAttempts: number = 2;

export async function assertManagedCaddyAutostopIsAvailable(
  dependencies: ICreateManagedCaddyAutostopSessionDependencies = {},
): Promise<void> {
  const paths: IManagedCaddyPaths = dependencies.paths ?? managedCaddyPaths;
  const isProcessAlive = dependencies.isProcessAlive ?? defaultIsProcessAlive;
  const existingOwner = await readManagedCaddyAutostopOwner(paths.autostopLockFilePath);

  if (existingOwner === null) {
    return;
  }

  if (existingOwner.ownerPid === process.pid || !isProcessAlive(existingOwner.ownerPid)) {
    await removeManagedCaddyAutostopLock(paths.autostopLockFilePath);
    return;
  }

  throw new Error(createManagedCaddyAutostopLockedErrorMessage(existingOwner));
}

export async function createManagedCaddyAutostopSession(
  options: ICreateManagedCaddyAutostopSessionOptions,
  logger: IDevhostLogger,
  dependencies: ICreateManagedCaddyAutostopSessionDependencies = {},
): Promise<IManagedCaddyAutostopSession> {
  const paths: IManagedCaddyPaths = dependencies.paths ?? managedCaddyPaths;
  const ensureManagedCaddyConfigImplementation: EnsureManagedCaddyConfigFunction =
    dependencies.ensureManagedCaddyConfig ?? ensureManagedCaddyConfig;
  const isProcessAlive: IsProcessAliveFunction = dependencies.isProcessAlive ?? defaultIsProcessAlive;
  const runManagedCaddyLifecycleCommandImplementation: ManagedCaddyLifecycleCommandFunction =
    dependencies.runManagedCaddyLifecycleCommand ?? runManagedCaddyLifecycleCommand;

  await ensureManagedCaddyConfigImplementation(paths);
  await assertNoOtherManagedRouteRegistrations(paths.registrationsDirectoryPath, isProcessAlive);
  await acquireManagedCaddyAutostopLock(options, paths, isProcessAlive);

  try {
    await runManagedCaddyLifecycleCommandImplementation("start", logger);
  } catch (error) {
    await removeManagedCaddyAutostopLock(paths.autostopLockFilePath);
    throw error;
  }

  let isReleased: boolean = false;

  return {
    release: async (): Promise<void> => {
      if (isReleased) {
        return;
      }

      isReleased = true;

      try {
        await runManagedCaddyLifecycleCommandImplementation("stop", logger);
      } finally {
        await removeManagedCaddyAutostopLock(paths.autostopLockFilePath);
      }
    },
  };
}

async function acquireManagedCaddyAutostopLock(
  options: ICreateManagedCaddyAutostopSessionOptions,
  paths: IManagedCaddyPaths,
  isProcessAlive: IsProcessAliveFunction,
): Promise<void> {
  const lockContents: string = JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      manifestPath: options.manifestPath,
      ownerPid: process.pid,
      stackName: options.stackName,
    } satisfies IManagedCaddyAutostopOwner,
    null,
    2,
  );

  for (let attemptIndex = 0; attemptIndex < lockRetryAttempts; attemptIndex += 1) {
    await assertManagedCaddyAutostopIsAvailable({ isProcessAlive, paths });

    try {
      await writeFile(paths.autostopLockFilePath, lockContents, {
        encoding: "utf8",
        flag: "wx",
      });
      return;
    } catch (error) {
      if (!isErrorWithCode(error) || error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  const existingOwner = await readManagedCaddyAutostopOwner(paths.autostopLockFilePath);

  if (existingOwner === null) {
    throw new Error("Managed Caddy autostop lock disappeared during acquisition.");
  }

  throw new Error(createManagedCaddyAutostopLockedErrorMessage(existingOwner));
}

async function assertNoOtherManagedRouteRegistrations(
  registrationsDirectoryPath: string,
  isProcessAlive: IsProcessAliveFunction,
): Promise<void> {
  const registrationFileNames: string[] = await readdir(registrationsDirectoryPath);

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = join(registrationsDirectoryPath, registrationFileName);
    const registrationText: string = await readFile(registrationPath, "utf8");
    const registration: IManagedRouteRegistration = parseManagedRouteRegistration(registrationText);

    if (registration.ownerPid === process.pid || !isProcessAlive(registration.ownerPid)) {
      continue;
    }

    throw new Error(
      `Cannot enable [caddy].autostop while ${registration.host} is claimed by PID ${registration.ownerPid} on port ${registration.port}. Stop the other devhost instance first.`,
    );
  }
}

async function readManagedCaddyAutostopOwner(lockFilePath: string): Promise<IManagedCaddyAutostopOwner | null> {
  try {
    const lockContents: string = await readFile(lockFilePath, "utf8");
    return parseManagedCaddyAutostopOwner(lockContents);
  } catch (error) {
    if (isErrorWithCode(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function removeManagedCaddyAutostopLock(lockFilePath: string): Promise<void> {
  await rm(lockFilePath, { force: true });
}

function createManagedCaddyAutostopLockedErrorMessage(owner: IManagedCaddyAutostopOwner): string {
  return [
    `Managed Caddy autostop is already owned by PID ${owner.ownerPid}.`,
    `stack: ${owner.stackName}`,
    `manifest: ${owner.manifestPath}`,
    "Stop the other devhost instance first, or disable [caddy].autostop.",
  ].join("\n");
}

function defaultIsProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function parseManagedCaddyAutostopOwner(lockContents: string): IManagedCaddyAutostopOwner {
  const parsedValue: unknown = JSON.parse(lockContents);

  if (!isManagedCaddyAutostopOwner(parsedValue)) {
    throw new Error("Managed Caddy autostop lock file is malformed.");
  }

  return parsedValue;
}

function parseManagedRouteRegistration(registrationText: string): IManagedRouteRegistration {
  const parsedValue: unknown = JSON.parse(registrationText);

  if (!isManagedRouteRegistration(parsedValue)) {
    throw new Error("Managed route registration is malformed.");
  }

  return parsedValue;
}

function isManagedCaddyAutostopOwner(value: unknown): value is IManagedCaddyAutostopOwner {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "createdAt") === "string" &&
    typeof Reflect.get(value, "manifestPath") === "string" &&
    typeof Reflect.get(value, "ownerPid") === "number" &&
    typeof Reflect.get(value, "stackName") === "string"
  );
}

function isManagedRouteRegistration(value: unknown): value is IManagedRouteRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "host") === "string" &&
    typeof Reflect.get(value, "ownerPid") === "number" &&
    typeof Reflect.get(value, "port") === "number"
  );
}

type ErrorWithCode = Error & { code: string };

function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return error instanceof Error && typeof Reflect.get(error, "code") === "string";
}
