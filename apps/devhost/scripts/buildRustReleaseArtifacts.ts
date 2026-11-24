import { Archive } from "bun";
import { chmod, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildDevtoolsBundle } from "./buildDevtoolsBundle";
import { buildRustRelease, readRustReleaseVersion } from "./buildRustRelease";
import { generateRustReleaseNotices } from "./generateRustReleaseNotices";
import { inspectRustReleaseBinary } from "./inspectRustReleaseBinary";
import { verifyRustReleaseRuntime } from "./verifyRustReleaseRuntime";

const targets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu.2.28",
  "linux-arm64": "aarch64-unknown-linux-gnu.2.28",
  "linux-x64-musl": "x86_64-unknown-linux-musl",
  "linux-arm64-musl": "aarch64-unknown-linux-musl",
};
type RustReleaseTarget = keyof typeof targets;

interface IBuildRustReleaseArtifactsOptions {
  targets?: readonly string[];
  outputDirectoryPath?: string;
  documentFilePaths?: readonly string[];
}

const repositoryDirectoryPath = resolve(import.meta.dir, "../../..");
const appDirectoryPath = join(repositoryDirectoryPath, "apps/devhost");
const rustDirectoryPath = join(appDirectoryPath, "rust");

async function command(args: string[], cwd = repositoryDirectoryPath): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [exitCode, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${args[0]} failed (${exitCode}): ${error}`);
  return output.trim();
}

function isTarget(value: string): value is RustReleaseTarget {
  return Object.hasOwn(targets, value);
}

async function sha256(filePath: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(filePath).bytes()).digest("hex");
}

export async function buildRustReleaseArtifacts(options: IBuildRustReleaseArtifactsOptions = {}): Promise<string> {
  const selectedTargets = [...new Set(options.targets ?? Object.keys(targets))];
  if (!selectedTargets.length) throw new Error("Expected at least one release target.");
  for (const target of selectedTargets) {
    if (!isTarget(target)) throw new Error(`Unsupported Rust archive target: ${target}`);
  }
  const documentFilePaths = options.documentFilePaths ?? [
    join(appDirectoryPath, "README.md"),
    join(repositoryDirectoryPath, "LICENSE"),
  ];
  for (const filePath of documentFilePaths) {
    if (!(await Bun.file(filePath).exists())) throw new Error(`Release document not found: ${filePath}`);
  }
  if (!["README.md", "LICENSE"].every((name) => documentFilePaths.some((filePath) => basename(filePath) === name)))
    throw new Error("Rust archives require README.md and LICENSE.");
  const metadata: unknown = await Bun.file(join(appDirectoryPath, "metadata.json")).json();
  const version = readRustReleaseVersion(
    metadata,
    process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined,
  );
  const revision = await command(["git", "rev-parse", "HEAD"]);
  const outputDirectoryPath = resolve(
    options.outputDirectoryPath ??
      join(appDirectoryPath, "dist/rust-candidates", `${version}-${revision.slice(0, 12)}-${Date.now()}`),
  );
  // Rename an entire completed candidate into place; never merge with or erase a prior candidate.
  try {
    await stat(outputDirectoryPath);
    throw new Error(`Candidate output already exists: ${outputDirectoryPath}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(join(repositoryDirectoryPath, ".tmp"), { recursive: true });
  const temporaryDirectoryPath = await mkdtemp(join(repositoryDirectoryPath, ".tmp/rust-archives-"));
  try {
    const candidateDirectoryPath = join(temporaryDirectoryPath, "candidate");
    await mkdir(candidateDirectoryPath);
    await buildDevtoolsBundle();
    const cargoMetadata: unknown = JSON.parse(
      await command(["cargo", "metadata", "--locked", "--format-version", "1"], rustDirectoryPath),
    );
    const sourceHasher = new Bun.CryptoHasher("sha256");
    const sourcePaths = (await command(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
      .split("\0")
      .filter(Boolean)
      .sort();
    for (const filePath of sourcePaths) {
      sourceHasher.update(`${filePath}\0`).update(await Bun.file(join(repositoryDirectoryPath, filePath)).bytes());
    }
    const sourceSha256 = sourceHasher.digest("hex");
    const artifacts = [];
    for (const target of selectedTargets) {
      if (!isTarget(target)) throw new Error(`Unsupported Rust archive target: ${target}`);
      if (target.startsWith("darwin") && process.platform !== "darwin")
        throw new Error("Build the macOS candidate on a matching native macOS host with its SDK.");
      const artifactLogPath = join(temporaryDirectoryPath, `${target}.jsonl`);
      const binaryPath = await buildRustRelease({
        target: targets[target],
        isCross: !target.startsWith("darwin"),
        artifactLogPath,
      });
      const inspection = await inspectRustReleaseBinary(binaryPath, target);
      const artifactName = `devhost-v${version}-${target}`;
      const stagingDirectoryPath = join(temporaryDirectoryPath, artifactName);
      await mkdir(stagingDirectoryPath);
      await Bun.write(join(stagingDirectoryPath, "devhost"), Bun.file(binaryPath));
      await chmod(join(stagingDirectoryPath, "devhost"), 0o755);
      for (const filePath of documentFilePaths) {
        await Bun.write(join(stagingDirectoryPath, basename(filePath)), Bun.file(filePath));
        await chmod(join(stagingDirectoryPath, basename(filePath)), 0o644);
      }
      await Bun.write(
        join(stagingDirectoryPath, "THIRD_PARTY_LICENSES.txt"),
        await generateRustReleaseNotices(cargoMetadata, await Bun.file(artifactLogPath).text()),
      );
      const archiveName = `${artifactName}.tar.gz`;
      const archivePath = join(candidateDirectoryPath, archiveName);
      // System tar preserves executable modes; Bun's content-map archive API has no mode input.
      await command(["tar", "-czf", archivePath, artifactName], temporaryDirectoryPath);
      const files = await new Archive(await Bun.file(archivePath).bytes()).files();
      const expectedNames = ["devhost", "README.md", "LICENSE", "THIRD_PARTY_LICENSES.txt"]
        .map((name) => `${artifactName}/${name}`)
        .sort();
      if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(expectedNames))
        throw new Error(`Unexpected archive layout: ${archiveName}`);
      const archivedBinary = files.get(`${artifactName}/devhost`);
      if (
        !archivedBinary ||
        new Bun.CryptoHasher("sha256").update(await archivedBinary.bytes()).digest("hex") !== (await sha256(binaryPath))
      )
        throw new Error(`Archive executable differs: ${archiveName}`);
      const extractionDirectoryPath = join(temporaryDirectoryPath, `extract-${target}`);
      await mkdir(extractionDirectoryPath);
      await command(["tar", "-xzf", archivePath, "-C", extractionDirectoryPath]);
      const executablePath = join(extractionDirectoryPath, artifactName, "devhost");
      if (((await stat(executablePath)).mode & 0o111) === 0)
        throw new Error(`Archive executable is not executable: ${archiveName}`);
      const isNative =
        target.startsWith("darwin") === (process.platform === "darwin") &&
        target.includes("arm64") === (process.arch === "arm64");
      let runtimeAcceptance: string = "requires matching native host";
      if (isNative) {
        if ((await command([executablePath, "--version"], extractionDirectoryPath)) !== version)
          throw new Error("Extracted executable has the wrong version.");
        await command([executablePath, "--help"], extractionDirectoryPath);
        await Bun.write(
          join(extractionDirectoryPath, "devhost.toml"),
          "name = 'archive-check'\n[services.web]\ncommand = 'echo archive-check'\nport = 39871\n",
        );
        if (!(await command([executablePath, "service", "list"], extractionDirectoryPath)).includes("web"))
          throw new Error("Extracted executable did not load its manifest.");
        runtimeAcceptance = await verifyRustReleaseRuntime(executablePath);
      }
      artifacts.push({
        target,
        rustTarget: targets[target],
        archive: archiveName,
        sha256: await sha256(archivePath),
        binarySha256: await sha256(binaryPath),
        ...inspection,
        nativeStartup: isNative ? "version/help/manifest passed" : "requires matching native host",
        runtimeAcceptance,
      });
    }
    await Bun.write(
      join(candidateDirectoryPath, "SHA256SUMS"),
      `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.archive}`).join("\n")}\n`,
    );
    await Bun.write(
      join(candidateDirectoryPath, "provenance.json"),
      `${JSON.stringify({ version, revision, sourceSha256, isDirty: (await command(["git", "status", "--porcelain"])).length > 0, rustc: await command(["rustc", "--version"]), cargo: await command(["cargo", "--version"]), zig: selectedTargets.some((target) => target.startsWith("linux")) ? await command(["zig", "version"]) : null, artifacts }, null, 2)}\n`,
    );
    await mkdir(resolve(outputDirectoryPath, ".."), { recursive: true });
    await rename(candidateDirectoryPath, outputDirectoryPath);
    return outputDirectoryPath;
  } finally {
    await rm(temporaryDirectoryPath, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { targets: { type: "string" }, output: { type: "string" } },
    strict: true,
  });
  console.log(
    await buildRustReleaseArtifacts({ targets: values.targets?.split(","), outputDirectoryPath: values.output }),
  );
}
