import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDevtoolsBundle } from "./buildDevtoolsBundle";

const releaseTargets = ["darwin-arm64", "linux-x64", "linux-arm64", "linux-x64-musl", "linux-arm64-musl"] as const;

type ReleaseTarget = (typeof releaseTargets)[number];

interface IPackageMetadata {
  name: string;
  version: string;
}

interface IBuildReleaseArtifactsOptions {
  documentFilePaths?: readonly string[];
  outputDirectoryPath?: string;
  targets: ReleaseTarget[];
}

interface IBuildReleaseArtifactOptions {
  artifactName: string;
  documentFilePaths: readonly string[];
  outputDirectoryPath: string;
  target: ReleaseTarget;
  version: string;
}

interface IReleaseTargetDetails {
  archivePlatformName: string;
  goArch: string;
  goOS: string;
}

const targetPlatformNames: Readonly<Record<ReleaseTarget, IReleaseTargetDetails>> = {
  "darwin-arm64": { archivePlatformName: "darwin-arm64", goArch: "arm64", goOS: "darwin" },
  "linux-arm64": { archivePlatformName: "linux-arm64", goArch: "arm64", goOS: "linux" },
  "linux-arm64-musl": { archivePlatformName: "linux-arm64-musl", goArch: "arm64", goOS: "linux" },
  "linux-x64": { archivePlatformName: "linux-x64", goArch: "amd64", goOS: "linux" },
  "linux-x64-musl": { archivePlatformName: "linux-x64-musl", goArch: "amd64", goOS: "linux" },
};
const releaseTargetNames: ReadonlySet<string> = new Set(releaseTargets);

const packageDirectoryPath: string = fileURLToPath(new URL("..", import.meta.url));
const defaultOutputDirectoryPath: string = join(packageDirectoryPath, "dist", "release");
const buildVersionVariablePath: string = "github.com/alexgorbatchev/devhost/apps/devhost/internal/version.buildVersion";
const packageManifestPath: string = join(packageDirectoryPath, "metadata.json");
const cliEntrypointPath: string = "./cmd/devhost";
// The license is the repository's; this workspace has no copy of its own.
const defaultDocumentFilePaths: readonly string[] = [
  join(packageDirectoryPath, "README.md"),
  join(packageDirectoryPath, "..", "..", "LICENSE"),
];

export async function buildReleaseArtifacts(
  options: IBuildReleaseArtifactsOptions = { targets: [...releaseTargets] },
): Promise<void> {
  const documentFilePaths = options.documentFilePaths ?? defaultDocumentFilePaths;
  const outputDirectoryPath = options.outputDirectoryPath ?? defaultOutputDirectoryPath;

  await requireReleaseDocuments(documentFilePaths);

  const packageMetadata = await readPackageMetadata(packageManifestPath);
  const artifactName = readArtifactName(packageMetadata.name);

  await buildDevtoolsBundle();
  await rm(outputDirectoryPath, { force: true, recursive: true });
  await mkdir(outputDirectoryPath, { recursive: true });

  for (const target of options.targets) {
    await buildReleaseArtifact({
      artifactName,
      documentFilePaths,
      outputDirectoryPath,
      target,
      version: packageMetadata.version,
    });
  }
}

async function requireReleaseDocuments(documentFilePaths: readonly string[]): Promise<void> {
  for (const documentFilePath of documentFilePaths) {
    if (!(await Bun.file(documentFilePath).exists())) {
      throw new Error(`Release document not found: ${documentFilePath}`);
    }
  }
}

async function buildReleaseArtifact(options: IBuildReleaseArtifactOptions): Promise<void> {
  const platformName: IReleaseTargetDetails = targetPlatformNames[options.target];
  const artifactBaseName: string = `${options.artifactName}-v${options.version}-${platformName.archivePlatformName}`;
  const stagingDirectoryPath: string = join(options.outputDirectoryPath, artifactBaseName);
  const archiveFilePath: string = join(options.outputDirectoryPath, `${artifactBaseName}.tar.gz`);
  const executableFilePath: string = join(stagingDirectoryPath, options.artifactName);
  const ldflags: string = `-X ${buildVersionVariablePath}=${options.version}`;

  await mkdir(stagingDirectoryPath, { recursive: true });

  const buildProcess = Bun.spawn(
    ["go", "build", "-trimpath", "-ldflags", ldflags, "-o", executableFilePath, cliEntrypointPath],
    {
      cwd: packageDirectoryPath,
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOARCH: platformName.goArch,
        GOOS: platformName.goOS,
      },
      stderr: "inherit",
      stdout: "inherit",
    },
  );

  const exitCode: number = await buildProcess.exited;

  if (exitCode !== 0) {
    throw new Error(`go build exited with code ${exitCode} while building ${options.target}.`);
  }

  for (const documentFilePath of options.documentFilePaths) {
    await Bun.write(join(stagingDirectoryPath, basename(documentFilePath)), Bun.file(documentFilePath));
  }

  await createTarGzArchive(options.outputDirectoryPath, artifactBaseName, archiveFilePath);
  await rm(stagingDirectoryPath, { force: true, recursive: true });

  console.log(`Built ${archiveFilePath}`);
}

function parseBuildReleaseArtifactsArguments(rawArguments: string[]): IBuildReleaseArtifactsOptions {
  let targets: ReleaseTarget[] = [...releaseTargets];

  for (const rawArgument of rawArguments) {
    if (rawArgument === "--help") {
      printHelp();
      process.exit(0);
    }

    if (rawArgument.startsWith("--targets=")) {
      targets = parseReleaseTargets(rawArgument.slice("--targets=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${rawArgument}`);
  }

  return { targets };
}

function parseReleaseTargets(rawValue: string): ReleaseTarget[] {
  const parsedTargets: ReleaseTarget[] = [];

  for (const rawTarget of rawValue.split(",")) {
    const target = rawTarget.trim();

    if (target.length === 0) {
      continue;
    }

    if (!isReleaseTarget(target)) {
      throw new Error(`Unsupported release target: ${target}`);
    }

    if (!parsedTargets.includes(target)) {
      parsedTargets.push(target);
    }
  }

  if (parsedTargets.length === 0) {
    throw new Error("Expected at least one release target.");
  }

  return parsedTargets;
}

function isReleaseTarget(value: string): value is ReleaseTarget {
  return releaseTargetNames.has(value);
}

function printHelp(): void {
  console.log(`Usage: just devhost build-release-artifacts [--targets=<comma-separated targets>]`);
  console.log(`Default targets: ${releaseTargets.join(", ")}`);
}

async function readPackageMetadata(filePath: string): Promise<IPackageMetadata> {
  const rawPackageMetadata: unknown = JSON.parse(await readFile(filePath, "utf8"));

  if (!isPackageMetadata(rawPackageMetadata)) {
    throw new Error(`Invalid package metadata in ${filePath}.`);
  }

  return rawPackageMetadata;
}

function isPackageMetadata(value: unknown): value is IPackageMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "version" in value &&
    typeof value.version === "string"
  );
}

function readArtifactName(packageName: string): string {
  const nameSegments = packageName.split("/");
  const artifactName = nameSegments.at(-1);

  if (artifactName === undefined || artifactName.length === 0) {
    throw new Error(`Invalid package name: ${packageName}`);
  }

  return artifactName;
}

async function createTarGzArchive(
  outputDirectoryPath: string,
  stagingDirectoryName: string,
  archiveFilePath: string,
): Promise<void> {
  const tarProcess = Bun.spawn(["tar", "-czf", archiveFilePath, stagingDirectoryName], {
    cwd: outputDirectoryPath,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode: number = await tarProcess.exited;

  if (exitCode !== 0) {
    throw new Error(`tar exited with code ${exitCode} while creating ${archiveFilePath}.`);
  }
}

if (import.meta.main) {
  const options = parseBuildReleaseArtifactsArguments(Bun.argv.slice(2));
  await buildReleaseArtifacts(options);
}
