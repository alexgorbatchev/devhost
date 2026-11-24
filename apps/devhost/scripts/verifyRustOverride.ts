import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [managerArgument, goArgument, rustArgument, evidenceArgument] = Bun.argv.slice(2);
if (!managerArgument || !goArgument || !rustArgument || !evidenceArgument) {
  throw new Error(
    "Usage: verifyRustOverride.ts <dotfiles executable> <Go executable> <Rust executable> <new evidence directory>",
  );
}
const manager = resolve(managerArgument);
const go = resolve(goArgument);
const rust = resolve(rustArgument);
const evidence = resolve(evidenceArgument);
await mkdir(evidence);
const root = await mkdtemp(join(tmpdir(), "dho."));
const home = join(root, "home");
const config = join(root, "dotfiles.config.ts");
const target = join(root, "target");
const generated = join(root, "generated");
const shim = join(target, "devhost");
const source = join(root, "rust-source");
const env = {
  ...process.env,
  AGENT: "1",
  BASH_ENV: "",
  HOME: home,
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_STATE_HOME: join(home, ".local/state"),
  DOTFILES_CLI_COMMAND: "",
  DOTFILES_REPO_ROOT: "",
  DOTFILES_LOCAL_USAGE_TRACKING: "0",
  PATH: `${target}:${process.env.PATH ?? ""}`,
};
const results = [];
const hash = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).bytes()).digest("hex");
async function run(name: string, command: string[], expectedError?: string) {
  const started = performance.now();
  const child = Bun.spawn(command, {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await Bun.write(join(evidence, `${name}.stdout`), stdout);
  await Bun.write(join(evidence, `${name}.stderr`), stderr);
  const accepted = expectedError ? code !== 0 && stderr.includes(expectedError) : code === 0;
  results.push({ name, code, expectedError, accepted, elapsedSeconds: (performance.now() - started) / 1000 });
  await Bun.write(join(evidence, "results.json"), JSON.stringify(results, null, 2));
  if (!accepted) throw new Error(`${name} returned ${code}: ${stdout}${stderr}`);
  return stdout.trim();
}
const cli = (...args: string[]) => [manager, "--config", config, ...args];
try {
  await mkdir(home);
  await Bun.write(
    config,
    `export default { paths: ${JSON.stringify({ dotfilesDir: root, homeDir: home, generatedDir: generated, targetDir: target })} };\n`,
  );
  await Bun.write(
    join(root, "tools/devhost.tool.ts"),
    `import { defineTool } from "@alexgorbatchev/dotfiles";\nexport default defineTool(install => install("manual", {binaryPath: ${JSON.stringify(go)}}).bin("devhost").version("0.0.20"));\n`,
  );
  await Bun.write(source, Bun.file(rust));
  await chmod(source, 0o755);
  const goHash = await hash(go);
  const rustHash = await hash(rust);
  await Bun.write(
    join(evidence, "provenance.json"),
    JSON.stringify(
      {
        managerSha256: await hash(manager),
        goSha256: goHash,
        rustSha256: rustHash,
        managedPayload: "staged Go oracle through the manual installer",
      },
      null,
      2,
    ),
  );
  await run("install-managed-go", cli("tool", "install", "devhost"));
  const managed = await run("managed-path", cli("tool", "which", "devhost", "--bin"));
  if ((await hash(managed)) !== goHash) throw new Error("Managed selection differs from staged Go payload");
  const goVersion = await run("go-version", [go, "--version"]);
  if (
    (await run("managed-shim", [
      "bash",
      "--noprofile",
      "--norc",
      "-c",
      "hash -r; command -v devhost; devhost --version",
    ])) !== `${shim}\n${goVersion}`
  )
    throw new Error("Managed PATH precedence failed");
  await run(
    "activate-rust",
    cli("tool", "dev", "use", "devhost", "--bin", `devhost=${source}`, "--version", "cutover-candidate"),
  );
  const selected = await run("rust-path", cli("tool", "which", "devhost", "--bin"));
  if (!selected.startsWith(`${generated}/dev-tools/`) || (await hash(selected)) !== rustHash)
    throw new Error("Override is not an immutable Rust copy");
  await Bun.file(source).delete();
  const rustVersion = await run("rust-version", [rust, "--version"]);
  if ((await run("rust-shim", [shim, "--version"])) !== rustVersion) throw new Error("Shim did not select Rust");
  const shimBefore = await Bun.file(shim).text();
  await run(
    "failed-replacement",
    cli("tool", "dev", "use", "devhost", "--bin", `devhost=${source}`),
    "no such file or directory",
  );
  if (
    (await run("preserved-selection", cli("tool", "which", "devhost", "--bin"))) !== selected ||
    (await Bun.file(shim).text()) !== shimBefore
  )
    throw new Error("Failed registration changed the active override");
  await run("protected-update", cli("tool", "update", "devhost", "--force"));
  if ((await run("protected-selection", cli("tool", "which", "devhost", "--bin"))) !== selected)
    throw new Error("Managed update replaced the override");
  await Bun.file(selected).delete();
  await run("broken-override-path", cli("tool", "which", "devhost", "--bin"), "is missing or is not a regular file");
  await run("broken-override-shim", [shim, "--version"], "is missing or not executable");
  await Bun.write(selected, Bun.file(rust));
  await chmod(selected, 0o755);
  await run("rollback-managed-go", cli("tool", "dev", "off", "devhost"));
  if (
    (await run("rollback-path", cli("tool", "which", "devhost", "--bin"))) !== managed ||
    (await run("rollback-shim", [shim, "--version"])) !== goVersion ||
    (await hash(managed)) !== goHash
  )
    throw new Error("Rollback did not restore the unchanged Go payload");
} finally {
  await rm(root, { recursive: true, force: true });
}
