import { access, rm } from "node:fs/promises";

import { createCaddyAdminApiUrl, managedCaddyPaths, resolveManagedCaddyAdminAddress } from "./caddyPaths";
import type { IDevhostLogger } from "../utils/createLogger";
import { ensureManagedCaddyConfig } from "./ensureManagedCaddyConfig";
import { resolveManagedCaddyBindDirective } from "./resolveManagedCaddyBindDirective";
import { ensureCaddyAdminAvailable } from "../utils/routeUtils";
import {
  createManagedCaddyExecutablePath,
  createManagedCaddyCommandErrorMessage,
  runManagedCaddyCommand,
  type ICaddyCommandResult,
  type IRunManagedCaddyCommandOptions,
  type ManagedCaddyCommandRunner,
  type StdioMode,
} from "./runManagedCaddyCommand";
import type { AsyncBooleanFunction, AsyncVoidFunction } from "../types/types";

export type ManagedCaddyLifecycleAction = "start" | "stop" | "trust" | "download" | "privileged-ports";

type SyncBooleanFunction = () => boolean;
type DownloadManagedCaddyFunction = (logger: IDevhostLogger) => Promise<void>;

interface IRunManagedCaddyLifecycleCommandDependencies {
  adminAddress?: string;
  downloadManagedCaddy?: DownloadManagedCaddyFunction;
  ensureManagedCaddyConfig?: AsyncVoidFunction;
  hasManagedCaddyBinary?: AsyncBooleanFunction;
  hasManagedPidFile?: AsyncBooleanFunction;
  hasManagedRootCertificate?: AsyncBooleanFunction;
  isRootUser?: SyncBooleanFunction;
  isManagedCaddyAvailable?: AsyncBooleanFunction;
  platform?: NodeJS.Platform;
  removeManagedPidFile?: AsyncVoidFunction;
  runManagedCaddyCommand?: ManagedCaddyCommandRunner;
  runPrivilegedPortSetupCommand?: ManagedCaddyCommandRunner;
}

export async function runManagedCaddyLifecycleCommand(
  action: ManagedCaddyLifecycleAction,
  logger: IDevhostLogger,
  dependencies: IRunManagedCaddyLifecycleCommandDependencies = {},
): Promise<number> {
  const managedCaddyAdminAddress: string = resolveManagedCaddyAdminAddress(dependencies.adminAddress);
  const ensureManagedCaddyConfigImplementation: AsyncVoidFunction =
    dependencies.ensureManagedCaddyConfig ??
    (async (): Promise<void> =>
      ensureManagedCaddyConfig(managedCaddyPaths, { adminAddress: managedCaddyAdminAddress }));
  const downloadManagedCaddy = dependencies.downloadManagedCaddy ?? defaultDownloadManagedCaddy;
  const hasManagedCaddyBinary: AsyncBooleanFunction =
    dependencies.hasManagedCaddyBinary ?? defaultHasManagedCaddyBinary;
  const hasManagedPidFile: AsyncBooleanFunction = dependencies.hasManagedPidFile ?? defaultHasManagedPidFile;
  const hasManagedRootCertificate: AsyncBooleanFunction =
    dependencies.hasManagedRootCertificate ?? defaultHasManagedRootCertificate;
  const isRootUser: SyncBooleanFunction = dependencies.isRootUser ?? defaultIsRootUser;
  const isManagedCaddyAvailable: AsyncBooleanFunction =
    dependencies.isManagedCaddyAvailable ??
    (async (): Promise<boolean> => defaultIsManagedCaddyAvailable(managedCaddyAdminAddress));
  const platform: NodeJS.Platform = dependencies.platform ?? process.platform;
  const removeManagedPidFile: AsyncVoidFunction = dependencies.removeManagedPidFile ?? defaultRemoveManagedPidFile;
  const runManagedCaddyCommandImplementation: ManagedCaddyCommandRunner =
    dependencies.runManagedCaddyCommand ?? runManagedCaddyCommand;
  const runPrivilegedPortSetupCommandImplementation: ManagedCaddyCommandRunner =
    dependencies.runPrivilegedPortSetupCommand ?? defaultRunPrivilegedPortSetupCommand;

  await ensureManagedCaddyConfigImplementation();

  if (action === "start") {
    await warnAboutAutomaticTrustInstall(logger, hasManagedRootCertificate);

    return await startManagedCaddy(
      logger,
      hasManagedPidFile,
      isManagedCaddyAvailable,
      managedCaddyAdminAddress,
      runManagedCaddyCommandImplementation,
    );
  }

  if (action === "stop") {
    return await stopManagedCaddy(
      logger,
      hasManagedPidFile,
      isManagedCaddyAvailable,
      managedCaddyAdminAddress,
      removeManagedPidFile,
      runManagedCaddyCommandImplementation,
    );
  }

  if (action === "download") {
    await downloadManagedCaddy(logger);
    return 0;
  }

  if (action === "privileged-ports") {
    return await configureManagedCaddyPrivilegedPorts(
      logger,
      downloadManagedCaddy,
      hasManagedCaddyBinary,
      isRootUser,
      platform,
      runPrivilegedPortSetupCommandImplementation,
    );
  }

  logger.info(
    "managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged.",
  );

  return await trustManagedCaddy(
    logger,
    hasManagedPidFile,
    isManagedCaddyAvailable,
    managedCaddyAdminAddress,
    runManagedCaddyCommandImplementation,
  );
}

async function startManagedCaddy(
  logger: IDevhostLogger,
  hasManagedPidFile: AsyncBooleanFunction,
  isManagedCaddyAvailable: AsyncBooleanFunction,
  adminAddress: string,
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
    throw new Error(createManagedCaddyStartErrorMessage(result));
  }

  logger.info(`managed caddy started with ${managedCaddyPaths.caddyfilePath}`);
  return 0;
}

async function stopManagedCaddy(
  logger: IDevhostLogger,
  hasManagedPidFile: AsyncBooleanFunction,
  isManagedCaddyAvailable: AsyncBooleanFunction,
  adminAddress: string,
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

  const result: ICaddyCommandResult = runManagedCaddyCommandImplementation(["stop"], { adminAddress });

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
  adminAddress: string,
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

  const result: ICaddyCommandResult = runManagedCaddyCommandImplementation(["trust"], {
    adminAddress,
    stdioMode: "inherit",
  });

  if (!result.success) {
    throw new Error(createManagedCaddyCommandErrorMessage("trust", result));
  }

  logger.info("managed caddy local CA trusted.");
  return 0;
}

async function configureManagedCaddyPrivilegedPorts(
  logger: IDevhostLogger,
  downloadManagedCaddy: DownloadManagedCaddyFunction,
  hasManagedCaddyBinary: AsyncBooleanFunction,
  isRootUser: SyncBooleanFunction,
  platform: NodeJS.Platform,
  runPrivilegedPortSetupCommandImplementation: ManagedCaddyCommandRunner,
): Promise<number> {
  if (platform === "darwin") {
    logger.info("managed caddy does not need privileged-port setup on macOS.");
    return 0;
  }

  if (platform !== "linux") {
    throw new Error("Managed Caddy privileged-port setup is currently supported on Linux only.");
  }

  if (!(await hasManagedCaddyBinary())) {
    logger.info(
      `managed caddy binary not found at ${createManagedCaddyExecutablePath(platform)}. Downloading it first.`,
    );
    await downloadManagedCaddy(logger);
  }

  logger.info(
    "managed caddy privileged-port setup may prompt for your password because granting low-port bind capability is privileged.",
  );

  const executablePath: string = createManagedCaddyExecutablePath(platform);
  const commandArguments: string[] = isRootUser()
    ? ["setcap", "cap_net_bind_service=+ep", executablePath]
    : ["sudo", "setcap", "cap_net_bind_service=+ep", executablePath];
  const result: ICaddyCommandResult = runPrivilegedPortSetupCommandImplementation(commandArguments, {
    stdioMode: "inherit",
  });

  if (!result.success) {
    throw new Error(
      "Managed Caddy privileged-port setup failed. Check that `sudo` and `setcap` are available, then try again.",
    );
  }

  logger.info(`managed caddy low-port binding enabled for ${executablePath}`);
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

async function defaultHasManagedCaddyBinary(): Promise<boolean> {
  try {
    await access(createManagedCaddyExecutablePath());
    return true;
  } catch {
    return false;
  }
}

async function defaultIsManagedCaddyAvailable(adminAddress: string): Promise<boolean> {
  try {
    await ensureCaddyAdminAvailable(createCaddyAdminApiUrl(adminAddress));
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

async function defaultDownloadManagedCaddy(logger: IDevhostLogger): Promise<void> {
  const { downloadCaddy } = await import("./downloadCaddy");

  await downloadCaddy(logger);
}

function defaultRunPrivilegedPortSetupCommand(
  arguments_: string[],
  options: IRunManagedCaddyCommandOptions = {},
): ICaddyCommandResult {
  const resolvedStdioMode: StdioMode = options.stdioMode ?? "pipe";
  const result = Bun.spawnSync(arguments_, {
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

function defaultIsRootUser(): boolean {
  return process.getuid?.() === 0;
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

  return (
    `${baseMessage}\nOpening HTTPS on :443 requires privileged-port setup on this platform. ` +
    `Run 'devhost caddy privileged-ports' to configure the managed Caddy binary.`
  );
}

function decodeManagedCaddyCommandOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}
