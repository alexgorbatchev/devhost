import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { IDevhostLogger } from "../utils/createLogger";
import type { ICaddyCommandResult, StdioMode } from "./runManagedCaddyCommand";

const defaultMacOsSystemKeychainPath: string = "/Library/Keychains/System.keychain";

type CreateTemporaryCertificateFileFunction = (certificate: Uint8Array) => Promise<string>;
type ExternalCommandRunner = (arguments_: string[], options?: IRunExternalCommandOptions) => ICaddyCommandResult;
type InstallTrustedCertificateFunction = (certificatePath: string) => Promise<void>;
type ReadRemoteRootCertificateFunction = (sshTarget: string) => Promise<Uint8Array>;
type RemoveTemporaryCertificateFileFunction = (certificatePath: string) => Promise<void>;
type SyncBooleanFunction = () => boolean;

interface IRunExternalCommandOptions {
  stdioMode?: StdioMode;
}

interface IInstallTrustedMacOsCertificateDependencies {
  isRootUser?: SyncBooleanFunction;
  keychainPath?: string;
  runExternalCommand?: ExternalCommandRunner;
}

interface IReadRemoteManagedCaddyRootCertificateDependencies {
  runExternalCommand?: ExternalCommandRunner;
}

interface ITrustManagedCaddyRemoteCertificateDependencies {
  createTemporaryCertificateFile?: CreateTemporaryCertificateFileFunction;
  installTrustedCertificate?: InstallTrustedCertificateFunction;
  platform?: NodeJS.Platform;
  readRemoteRootCertificate?: ReadRemoteRootCertificateFunction;
  removeTemporaryCertificateFile?: RemoveTemporaryCertificateFileFunction;
}

export async function trustManagedCaddyRemoteCertificate(
  sshTarget: string,
  logger: IDevhostLogger,
  dependencies: ITrustManagedCaddyRemoteCertificateDependencies = {},
): Promise<number> {
  const createTemporaryCertificateFile: CreateTemporaryCertificateFileFunction =
    dependencies.createTemporaryCertificateFile ?? defaultCreateTemporaryCertificateFile;
  const installTrustedCertificate: InstallTrustedCertificateFunction =
    dependencies.installTrustedCertificate ?? installTrustedMacOsCertificate;
  const platform: NodeJS.Platform = dependencies.platform ?? process.platform;
  const readRemoteRootCertificate: ReadRemoteRootCertificateFunction =
    dependencies.readRemoteRootCertificate ?? readRemoteManagedCaddyRootCertificate;
  const removeTemporaryCertificateFile: RemoveTemporaryCertificateFileFunction =
    dependencies.removeTemporaryCertificateFile ?? defaultRemoveTemporaryCertificateFile;

  if (platform !== "darwin") {
    throw new Error("Managed Caddy remote trust is currently supported on macOS only.");
  }

  logger.info(
    "managed caddy remote trust may prompt for your password because installing a root CA into the system trust store is privileged.",
  );

  const certificate: Uint8Array = await readRemoteRootCertificate(sshTarget);
  const certificateSha256: string = createHash("sha256").update(certificate).digest("hex");
  const temporaryCertificatePath: string = await createTemporaryCertificateFile(certificate);

  try {
    logger.info(`managed caddy remote root sha256 from ${sshTarget}: ${certificateSha256}`);
    await installTrustedCertificate(temporaryCertificatePath);
  } finally {
    await removeTemporaryCertificateFile(temporaryCertificatePath);
  }

  logger.info(`managed caddy local CA from ${sshTarget} trusted.`);
  return 0;
}

export async function readRemoteManagedCaddyRootCertificate(
  sshTarget: string,
  dependencies: IReadRemoteManagedCaddyRootCertificateDependencies = {},
): Promise<Uint8Array> {
  const runExternalCommand: ExternalCommandRunner = dependencies.runExternalCommand ?? defaultRunExternalCommand;
  const result: ICaddyCommandResult = runExternalCommand(["ssh", sshTarget, "devhost", "caddy", "print-root-cert"]);

  if (!result.success) {
    throw new Error(
      createExternalCommandErrorMessage(
        `Failed to fetch the managed Caddy root certificate from ${sshTarget}. Check SSH access and confirm 'devhost' is installed on the remote host.`,
        result,
      ),
    );
  }

  return result.stdout;
}

export async function installTrustedMacOsCertificate(
  certificatePath: string,
  dependencies: IInstallTrustedMacOsCertificateDependencies = {},
): Promise<void> {
  const isRootUser: SyncBooleanFunction = dependencies.isRootUser ?? defaultIsRootUser;
  const keychainPath: string = dependencies.keychainPath ?? defaultMacOsSystemKeychainPath;
  const runExternalCommand: ExternalCommandRunner = dependencies.runExternalCommand ?? defaultRunExternalCommand;
  const commandArguments: string[] = isRootUser()
    ? ["security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychainPath, certificatePath]
    : ["sudo", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychainPath, certificatePath];
  const result: ICaddyCommandResult = runExternalCommand(commandArguments, { stdioMode: "inherit" });

  if (!result.success) {
    throw new Error("Failed to install the fetched managed Caddy root certificate into the macOS system keychain.");
  }
}

async function defaultCreateTemporaryCertificateFile(certificate: Uint8Array): Promise<string> {
  const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-caddy-remote-trust-"));
  const certificatePath: string = join(temporaryDirectoryPath, "root.crt");

  await writeFile(certificatePath, certificate);

  return certificatePath;
}

async function defaultRemoveTemporaryCertificateFile(certificatePath: string): Promise<void> {
  await rm(dirname(certificatePath), { force: true, recursive: true });
}

function defaultRunExternalCommand(
  arguments_: string[],
  options: IRunExternalCommandOptions = {},
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

function createExternalCommandErrorMessage(baseMessage: string, result: ICaddyCommandResult): string {
  const combinedOutput: string = [decodeCommandOutput(result.stderr), decodeCommandOutput(result.stdout)]
    .filter((text: string): boolean => text.length > 0)
    .join("\n");

  if (combinedOutput.length === 0) {
    return baseMessage;
  }

  return `${baseMessage}\n${combinedOutput}`;
}

function decodeCommandOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}
