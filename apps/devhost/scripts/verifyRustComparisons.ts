import { chmod, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import inventory from "../rust/parity/inventory.json";

const root = resolve(import.meta.dir, "../../..");
const [oracleArgument, repairedArgument, rustArgument, outputArgument] = Bun.argv.slice(2);
if (!oracleArgument || !repairedArgument || !rustArgument || !outputArgument) {
  throw new Error(
    "Usage: verifyRustComparisons.ts <Go oracle checkout> <repaired Go binary> <optimized Rust binary> <new evidence directory>",
  );
}
const oracle = resolve(oracleArgument);
const output = resolve(outputArgument);
await mkdir(output, { recursive: false });
const git = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
};
if (
  git(oracle, "rev-parse", "HEAD") !== inventory.goSha ||
  git(oracle, "status", "--porcelain", "--untracked-files=no")
) {
  throw new Error("The Go oracle must be a clean checkout of inventory.goSha.");
}
const candidates = [
  { name: "go-oracle", path: resolve(oracle, "apps/devhost/bin/devhost") },
  { name: "go-repaired", path: resolve(repairedArgument) },
  { name: "rust-optimized", path: resolve(rustArgument) },
];
await mkdir(resolve(output, "binaries"));
const binaries = await Promise.all(
  candidates.map(async (candidate) => {
    const path = resolve(output, "binaries", candidate.name);
    await copyFile(candidate.path, path);
    await chmod(path, 0o755);
    return { name: candidate.name, sourcePath: candidate.path, path };
  }),
);
const sha256 = async (path: string) =>
  new Bun.CryptoHasher("sha256").update(await Bun.file(path).bytes()).digest("hex");
const provenance = {
  goRevision: inventory.goSha,
  candidateRevision: git(root, "rev-parse", "HEAD"),
  candidateStatus: git(root, "status", "--porcelain"),
  candidatePatchSha256: new Bun.CryptoHasher("sha256").update(git(root, "diff", "HEAD", "--binary")).digest("hex"),
  runnerSha256: await sha256(import.meta.path),
  platform: process.platform,
  architecture: process.arch,
  rustc: Bun.spawnSync(["rustc", "-Vv"], { cwd: resolve(root, "apps/devhost/rust") }).stdout.toString(),
  binaries: await Promise.all(binaries.map(async (binary) => ({ ...binary, sha256: await sha256(binary.path) }))),
};
await Bun.write(resolve(output, "provenance.json"), JSON.stringify(provenance, null, 2));
const corpora = Array.from(new Bun.Glob("apps/devhost/rust/tests/*.jsonl").scanSync(root)).sort();
if (corpora.length === 0) throw new Error("No Rust Anything corpora found.");
const inputs = await Promise.all(
  corpora.map(async (path) => ({
    path,
    sha256: await sha256(resolve(root, path)),
    cases: (await Bun.file(resolve(root, path)).text()).trim().split("\n").length,
  })),
);
await Bun.write(resolve(output, "inputs.json"), JSON.stringify(inputs, null, 2));
const nativeInputs = await Promise.all(
  Array.from(new Bun.Glob("apps/devhost/rust/tests/**/*.rs").scanSync(root))
    .sort()
    .map(async (path) => ({ path, sha256: await sha256(resolve(root, path)) })),
);
await Bun.write(resolve(output, "native-inputs.json"), JSON.stringify(nativeInputs, null, 2));
const results = [];
async function run(name: string, command: string[], binary: string, expectedFailure?: string) {
  const started = performance.now();
  const log = resolve(output, `${name}.log`);
  const child = Bun.spawn(command, {
    cwd: resolve(root, "apps/devhost/rust"),
    env: {
      ...process.env,
      DEVHOST_STACK_TEST_BINARY: binary,
      DEVHOST_REMOTE_TEST_BINARY: binary,
      DEVHOST_CLI_TEST_BINARY: binary,
      DEVHOST_CADDY_TEST_BINARY: binary,
      DEVHOST_CLI_TEST_VERSION: Bun.spawnSync([binary, "--version"]).stdout.toString().trim(),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await Bun.write(`${log}.stdout`, stdout);
  await Bun.write(`${log}.stderr`, stderr);
  const text = `${stdout}\n${stderr}`;
  await Bun.write(log, text);
  const accepted = expectedFailure
    ? exitCode === 101 && text.includes(expectedFailure) && text.includes("0 passed; 1 failed;")
    : exitCode === 0;
  results.push({
    name,
    command,
    binary,
    exitCode,
    expectedFailure,
    accepted,
    stdoutSha256: await sha256(`${log}.stdout`),
    stderrSha256: await sha256(`${log}.stderr`),
    elapsedSeconds: (performance.now() - started) / 1000,
  });
  await Bun.write(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(`${name}: ${accepted ? "accepted" : "FAILED"} (${exitCode})`);
  if (!accepted) throw new Error(`Unexpected comparison result; see ${log}`);
}
const cargo = (suite: string, ...args: string[]) => ["cargo", "test", "--locked", "--test", suite, ...args];
const duplicate = "lifecycle::included_groups_dependencies_always_start_watches_and_start_stopped_match";
const legacy = "documents::external_proxy_preserves_document_bytes_headers_recovery_and_backend_ownership";
for (const binary of binaries) {
  const isOracle = binary.name === "go-oracle";
  await run(
    `${binary.name}-stack`,
    cargo("stack_commands", "--", ...(isOracle ? ["--skip", duplicate, "--skip", legacy] : [])),
    binary.path,
  );
  if (isOracle) {
    await run(
      "go-oracle-duplicate-restart",
      cargo("stack_commands", duplicate, "--", "--exact"),
      binary.path,
      "a duplicate restart batch must restart web exactly once",
    );
    await run(
      "go-oracle-legacy-document",
      cargo("stack_commands", legacy, "--", "--exact"),
      binary.path,
      "document bytes changed for /legacy",
    );
  }
  await run(`${binary.name}-relay`, cargo("remote_transport"), binary.path);
  await run(`${binary.name}-certificate`, cargo("root_certificate"), binary.path);
  await run(
    `${binary.name}-caddy`,
    cargo("caddy_generation", "native_cli_restart_receipt_and_settings_contract_matches_go", "--", "--exact"),
    binary.path,
  );
  await run(`${binary.name}-compatibility`, cargo("stack_lifecycle", "compatibility::"), binary.path);
  for (const test of [
    "detach_live_cli_start_idempotency_and_stop",
    "detach_live_sigterm_cancels_startup_promptly",
    "detach_symlink_manifest_and_append_logs_across_restarts",
  ]) {
    await run(`${binary.name}-${test}`, cargo("detach_lifecycle", test, "--", "--exact"), binary.path);
  }
  await run(
    `${binary.name}-cli`,
    cargo(
      "cli",
      "--",
      "--skip",
      "help_entry_points_obey_mode_and_terminal_width",
      "--skip",
      "completion_installation_help_covers_all_shells",
      "--skip",
      "invalid_arguments_report_to_stderr_and_point_to_usage",
    ),
    binary.path,
  );
  await run(
    `${binary.name}-command-tree`,
    [
      "bun",
      resolve(root, "apps/devhost/scripts/verifyRustCommandTree.ts"),
      binaries[0]!.path,
      binary.path,
      resolve(output, `${binary.name}-help.json`),
    ],
    binary.path,
  );
}
const toolVersion = Bun.spawnSync(["rust-anything", "--version"]);
if (toolVersion.exitCode !== 0 || toolVersion.stdout.toString().trim() !== "rust-anything 3.3.0") {
  throw new Error("Rust Anything 3.3.0 is required.");
}
for (const corpus of corpora) {
  const path = resolve(root, corpus);
  const name = corpus
    .split("/")
    .at(-1)!
    .replace(/\.jsonl$/, "");
  const recording = resolve(output, `recording-${name}`);
  await mkdir(recording);
  await run(
    `record-${name}`,
    [
      "rust-anything",
      "app",
      "record",
      recording,
      "--inputs",
      path,
      "--no-traps",
      "--name",
      "devhost",
      "--",
      binaries[0]!.path,
    ],
    binaries[0]!.path,
  );
  await run(
    `replay-${name}`,
    ["rust-anything", "app", "replay", recording, "--build", binaries[2]!.path],
    binaries[2]!.path,
  );
}
