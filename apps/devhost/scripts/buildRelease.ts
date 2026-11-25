import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";

const appDirectoryPath: string = resolve(import.meta.dir, "..");
const repositoryDirectoryPath: string = resolve(appDirectoryPath, "../..");

interface IBuildRustReleaseOptions {
  target?: string;
  isCross?: boolean;
  artifactLogPath?: string;
}

export function readRustReleaseVersion(metadata: unknown, tag?: string): string {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("name" in metadata) ||
    metadata.name !== "devhost" ||
    !("version" in metadata) ||
    typeof metadata.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(metadata.version)
  ) {
    throw new Error("Expected devhost release metadata with a stable semantic version.");
  }
  if (tag !== undefined && tag !== `v${metadata.version}`) {
    throw new Error(`Release tag ${tag} does not match metadata version v${metadata.version}.`);
  }
  return metadata.version;
}

export async function buildRustRelease(options: IBuildRustReleaseOptions = {}): Promise<string> {
  const { target, isCross = false, artifactLogPath } = options;
  const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
  const metadata: unknown = await Bun.file(join(appDirectoryPath, "metadata.json")).json();
  const version = readRustReleaseVersion(metadata, tag);
  if (target !== undefined && !/^(aarch64|x86_64)-(apple-darwin|unknown-linux-(gnu|musl))(\.\d+\.\d+)?$/.test(target)) {
    throw new Error(`Unsupported Rust release target: ${target}`);
  }
  const temporaryRootPath = join(repositoryDirectoryPath, ".tmp");
  await mkdir(temporaryRootPath, { recursive: true });
  const temporaryDirectoryPath = await mkdtemp(join(temporaryRootPath, "rust-release-"));
  try {
    const cargoHomePath = resolve(process.env.CARGO_HOME ?? join(homedir(), ".cargo"));
    const existingFlags =
      process.env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f") ?? process.env.RUSTFLAGS?.split(/\s+/).filter(Boolean) ?? [];
    const encodedFlags = [
      ...existingFlags,
      `--remap-path-prefix=${repositoryDirectoryPath}=/devhost`,
      `--remap-path-prefix=${cargoHomePath}=/cargo`,
    ].join("\x1f");
    const command = [
      "cargo",
      isCross ? "zigbuild" : "build",
      "--release",
      "--locked",
      "--bin",
      "devhost",
      "--message-format=json-render-diagnostics",
    ];
    if (target !== undefined) {
      command.push("--target", target);
    }
    const child = Bun.spawn(command, {
      cwd: appDirectoryPath,
      env: {
        ...process.env,
        DEVHOST_BUILD_VERSION: version,
        DEVHOST_BUILD_SOURCE_DIRECTORY: "",
        TMPDIR: temporaryDirectoryPath,
        CARGO_ENCODED_RUSTFLAGS: encodedFlags,
      },
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
    });
    const [exitCode, artifactLog] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    if (artifactLogPath !== undefined) {
      await Bun.write(artifactLogPath, artifactLog);
    }
    if (exitCode !== 0) {
      throw new Error(`Rust release build failed with exit code ${exitCode}.`);
    }
    for (const line of artifactLog.trim().split("\n")) {
      const artifact: unknown = JSON.parse(line);
      if (
        typeof artifact === "object" &&
        artifact !== null &&
        "reason" in artifact &&
        artifact.reason === "compiler-artifact" &&
        "executable" in artifact &&
        typeof artifact.executable === "string" &&
        "target" in artifact &&
        typeof artifact.target === "object" &&
        artifact.target !== null &&
        "name" in artifact.target &&
        artifact.target.name === "devhost"
      ) {
        if (!(await Bun.file(artifact.executable).exists())) {
          throw new Error(`Rust release executable not found: ${artifact.executable}`);
        }
        return artifact.executable;
      }
    }
    throw new Error("Cargo did not report a devhost release executable.");
  } finally {
    await rm(temporaryDirectoryPath, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { target: { type: "string" }, cross: { type: "boolean", default: false } },
    strict: true,
  });
  console.log(await buildRustRelease({ target: values.target, isCross: values.cross }));
}
