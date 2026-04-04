import { access, rm } from "node:fs/promises";

import { managedCaddyPaths } from "./caddyPaths";
import type { IDevhostLogger } from "../utils/createLogger";
import { ensureManagedCaddyConfig } from "./ensureManagedCaddyConfig";
import { resolveManagedCaddyBindDirective } from "./resolveManagedCaddyBindDirective";
import { ensureCaddyAdminAvailable } from "../utils/routeUtils";
import {
  createManagedCaddyCommandErrorMessage,
  runManagedCaddyCommand,
  type ICaddyCommandResult,
  type ManagedCaddyCommandRunner,
} from "./runManagedCaddyCommand";
import type { AsyncBooleanFunction, AsyncVoidFunction } from "../types/types";

export type ManagedCaddyLifecycleAction = "start" | "stop" | "trust" | "download";

interface IRunManagedCaddyLifecycleCommandDependencies {
  ensureManagedCaddyConfig?: AsyncVoidFunction;
  hasManagedPidFile?: AsyncBooleanFunction;
  hasManagedRootCertificate?: AsyncBooleanFunction;
  isManagedCaddyAvailable?: AsyncBooleanFunction;
  removeManagedPidFile?: AsyncVoidFunction;
  runManagedCaddyCommand?: ManagedCaddyCommandRunner;
}

export async function runManagedCaddyLifecycleCommand(
  action: ManagedCaddyLifecycleAction,
  logger: IDevhostLogger,
  dependencies: IRunManagedCaddyLifecycleCommandDependencies = {},
): Promise<number> {
  const ensureManagedCaddyConfigImplementation: AsyncVoidFunction =
    dependencies.ensureManagedCaddyConfig ?? ensureManagedCaddyConfig;
  const hasManagedPidFile: AsyncBooleanFunction = dependencies.hasManagedPidFile ?? defaultHasManagedPidFile;
  const hasManagedRootCertificate: AsyncBooleanFunction =
    dependencies.hasManagedRootCertificate ?? defaultHasManagedRootCertificate;
  const isManagedCaddyAvailable: AsyncBooleanFunction =
    dependencies.isManagedCaddyAvailable ?? defaultIsManagedCaddyAvailable;
  const removeManagedPidFile: AsyncVoidFunction = dependencies.removeManagedPidFile ?? defaultRemoveManagedPidFile;
  const runManagedCaddyCommandImplementation: ManagedCaddyCommandRunner =
    dependencies.runManagedCaddyCommand ?? runManagedCaddyCommand;

  await ensureManagedCaddyConfigImplementation();

  if (action === "start") {
    await warnAboutAutomaticTrustInstall(logger, hasManagedRootCertificate);

    return await startManagedCaddy(
      logger,
      hasManagedPidFile,
      isManagedCaddyAvailable,
      runManagedCaddyCommandImplementation,
    );
  }

  if (action === "stop") {
    return await stopManagedCaddy(
      logger,
      hasManagedPidFile,
      isManagedCaddyAvailable,
      removeManagedPidFile,
      runManagedCaddyCommandImplementation,
    );
  }

  if (action === "download") {
    const { downloadCaddy } = await import("./downloadCaddy");
    await downloadCaddy(logger);
    return 0;
  }

  logger.info(
    "managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged.",
  );

  return await trustManagedCaddy(
    logger,
    hasManagedPidFile,
    isManagedCaddyAvailable,
    runManagedCaddyCommandImplementation,
  );
}

async function startManagedCaddy(
  logger: IDevhostLogger,
  hasManagedPidFile: AsyncBooleanFunction,
  isManagedCaddyAvailable: AsyncBooleanFunction,
  runManagedCaddyCommandImplementation: ManagedCaddyCommandRunner,
): Promise<number> {
  if (await isManagedCaddyAvailable()) {
    if (await hasManagedPidFile()) {
      logger.info(`managed caddy is already running with ${managedCaddyPaths.caddyfilePath}`);
      return 0;
    }

    throw new Error(
      "A Caddy admin API is already listening on the devhost-managed address, but it was not started by devhost.",
    );
  }

  const result: ICaddyCommandResult = runManagedCaddyCommandImplementation(
    ["start", "--pidfile", managedCaddyPaths.pidFilePath],
    { stdioMode: "inherit" },
  );

  if (!result.success) {
    throw new Error(createManagedCaddyCommandErrorMessage("start", result));
  }

  logger.info(`managed caddy started with ${managedCaddyPaths.caddyfilePath}`);
  return 0;
}

async function stopManagedCaddy(
  logger: IDevhostLogger,
  hasManagedPidFile: AsyncBooleanFunction,
  isManagedCaddyAvailable: AsyncBooleanFunction,
  removeManagedPidFile: AsyncVoidFunction,
  runManagedCaddyCommandImplementation: ManagedCaddyCommandRunner,
): Promise<number> {
  const isManagedProcessKnown: boolean = await hasManagedPidFile();
  const isManagedProcessAvailable: boolean = await isManagedCaddyAvailable();

  if (!isManagedProcessAvailable) {
    if (isManagedProcessKnown) {
      await removeManagedPidFile();
      logger.info("managed caddy is not running. Removed the stale pid file.");
      return 0;
    }

    logger.info("managed caddy is not running.");
    return 0;
  }

  if (!isManagedProcessKnown) {
    throw new Error(
      "A Caddy admin API is already listening on the devhost-managed address, but it was not started by devhost.",
    );
  }

  const result: ICaddyCommandResult = runManagedCaddyCommandImplementation(["stop"]);

  if (!result.success) {
    throw new Error(createManagedCaddyCommandErrorMessage("stop", result));
  }

  await removeManagedPidFile();
  logger.info("managed caddy stopped.");
  return 0;
}

async function trustManagedCaddy(
  logger: IDevhostLogger,
  hasManagedPidFile: AsyncBooleanFunction,
  isManagedCaddyAvailable: AsyncBooleanFunction,
  runManagedCaddyCommandImplementation: ManagedCaddyCommandRunner,
): Promise<number> {
  if (!(await isManagedCaddyAvailable())) {
    throw new Error("Managed Caddy is not running. Run 'devhost caddy start' first.");
  }

  if (!(await hasManagedPidFile())) {
    throw new Error(
      "A Caddy admin API is already listening on the devhost-managed address, but it was not started by devhost.",
    );
  }

  const result: ICaddyCommandResult = runManagedCaddyCommandImplementation(["trust"], { stdioMode: "inherit" });

  if (!result.success) {
    throw new Error(createManagedCaddyCommandErrorMessage("trust", result));
  }

  logger.info("managed caddy local CA trusted.");
  return 0;
}

async function defaultHasManagedPidFile(): Promise<boolean> {
  try {
    await access(managedCaddyPaths.pidFilePath);
    return true;
  } catch {
    return false;
  }
}

async function defaultIsManagedCaddyAvailable(): Promise<boolean> {
  try {
    await ensureCaddyAdminAvailable();
    return true;
  } catch {
    return false;
  }
}

async function defaultRemoveManagedPidFile(): Promise<void> {
  await rm(managedCaddyPaths.pidFilePath, { force: true });
}

async function defaultHasManagedRootCertificate(): Promise<boolean> {
  try {
    await access(managedCaddyPaths.rootCertificatePath);
    return true;
  } catch {
    return false;
  }
}

async function warnAboutAutomaticTrustInstall(
  logger: IDevhostLogger,
  hasManagedRootCertificate: AsyncBooleanFunction,
): Promise<void> {
  if (await hasManagedRootCertificate()) {
    return;
  }

  logger.info(
    "managed caddy may prompt for your password on first start so it can install its local CA into the system trust store.",
  );
}

export function createManagedCaddyStartErrorMessage(
  result: ICaddyCommandResult,
  platform: NodeJS.Platform = process.platform,
): string {
  const baseMessage: string = createManagedCaddyCommandErrorMessage("start", result);
  const combinedOutput: string = [
    decodeManagedCaddyCommandOutput(result.stderr),
    decodeManagedCaddyCommandOutput(result.stdout),
  ]
    .filter((text: string): boolean => text.length > 0)
    .join("\n");

  if (!combinedOutput.includes("bind: permission denied") || !combinedOutput.includes(":443")) {
    return baseMessage;
  }

  if (resolveManagedCaddyBindDirective(platform) === null) {
    return `${baseMessage}\nmacOS allows rootless binds on :443 only with wildcard listeners, not loopback-specific ones.`;
  }

  return `${baseMessage}\nOpening HTTPS on :443 requires privileged-port setup on this platform.`;
}

function decodeManagedCaddyCommandOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}
