import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDevtoolsBundle } from "./buildDevtoolsBundle";

const releaseTargets = [
  "bun-darwin-arm64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
] as const;

type ReleaseTarget = (typeof releaseTargets)[number];

interface IPackageMetadata {
  name: string;
  version: string;
}

interface IBuildReleaseArtifactsOptions {
  targets: ReleaseTarget[];
}

const targetPlatformNames: Readonly<Record<ReleaseTarget, string>> = {
  "bun-darwin-arm64": "darwin-arm64",
  "bun-linux-arm64": "linux-arm64",
  "bun-linux-arm64-musl": "linux-arm64-musl",
  "bun-linux-x64": "linux-x64",
  "bun-linux-x64-musl": "linux-x64-musl",
};
const releaseTargetNames: ReadonlySet<string> = new Set(releaseTargets);

const packageDirectoryPath: string = fileURLToPath(new URL("..", import.meta.url));
const artifactOutputDirectoryPath: string = join(packageDirectoryPath, "dist", "release");
const packageManifestPath: string = join(packageDirectoryPath, "package.json");
const cliEntrypointPath: string = join(packageDirectoryPath, "bin", "devhost.ts");
const readmeFilePath: string = join(packageDirectoryPath, "README.md");
const licenseFilePath: string = join(packageDirectoryPath, "LICENSE");

export async function buildReleaseArtifacts(
  options: IBuildReleaseArtifactsOptions = { targets: [...releaseTargets] },
): Promise<void> {
  const packageMetadata = await readPackageMetadata(packageManifestPath);
  const artifactName = readArtifactName(packageMetadata.name);

  await buildDevtoolsBundle();
  await rm(artifactOutputDirectoryPath, { force: true, recursive: true });
  await mkdir(artifactOutputDirectoryPath, { recursive: true });

  for (const target of options.targets) {
    await buildReleaseArtifact({ artifactName, target, version: packageMetadata.version });
  }
}

async function buildReleaseArtifact(options: {
  artifactName: string;
  target: ReleaseTarget;
  version: string;
}): Promise<void> {
  const platformName: string = targetPlatformNames[options.target];
  const artifactBaseName: string = `${options.artifactName}-v${options.version}-${platformName}`;
  const stagingDirectoryPath: string = join(artifactOutputDirectoryPath, artifactBaseName);
  const archiveFilePath: string = join(artifactOutputDirectoryPath, `${artifactBaseName}.tar.gz`);
  const executableFilePath: string = join(stagingDirectoryPath, options.artifactName);

  await mkdir(stagingDirectoryPath, { recursive: true });

  const buildResult = await Bun.build({
    compile: {
      outfile: executableFilePath,
      target: options.target,
    },
    entrypoints: [cliEntrypointPath],
    minify: true,
    throw: false,
  });

  if (!buildResult.success) {
    const logMessages: string = buildResult.logs.map((log) => log.message).join("\n");

    throw new Error(`Failed to build ${options.target}:\n${logMessages}`);
  }

  await cp(readmeFilePath, join(stagingDirectoryPath, "README.md"));

  if (await doesFileExist(licenseFilePath)) {
    await cp(licenseFilePath, join(stagingDirectoryPath, "LICENSE"));
  }

  await createTarGzArchive(artifactBaseName, archiveFilePath);
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
  console.log(`Usage: bun run build:release-artifacts [--targets=<comma-separated bun targets>]`);
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

async function createTarGzArchive(stagingDirectoryName: string, archiveFilePath: string): Promise<void> {
  const tarProcess = Bun.spawn(["tar", "-czf", archiveFilePath, stagingDirectoryName], {
    cwd: artifactOutputDirectoryPath,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode: number = await tarProcess.exited;

  if (exitCode !== 0) {
    throw new Error(`tar exited with code ${exitCode} while creating ${archiveFilePath}.`);
  }
}

async function doesFileExist(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const options = parseBuildReleaseArtifactsArguments(Bun.argv.slice(2));
  await buildReleaseArtifacts(options);
}
