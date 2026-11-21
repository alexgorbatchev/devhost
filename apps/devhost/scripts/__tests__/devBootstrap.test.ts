import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { devBootstrap } from "../devBootstrap";

let directoryPath: string;
let dotfilesPath: string;
let binaryPath: string;
let sourcePath: string;
let developmentPath: string;
let previousPath: string;

beforeEach(async () => {
  const temporaryRootPath = resolve(import.meta.dir, "../../../..", ".tmp");
  await mkdir(temporaryRootPath, { recursive: true });
  directoryPath = await mkdtemp(join(temporaryRootPath, "dev-bootstrap-"));
  dotfilesPath = join(directoryPath, "dotfiles with spaces");
  binaryPath = join(dotfilesPath, ".generated/binaries/devhost/v1/devhost");
  developmentPath = join(dotfilesPath, ".state/custom-dev-tools/devhost");
  sourcePath = join(directoryPath, "build with spaces/devhost");
  await Bun.write(binaryPath, "managed release");
  await Bun.write(sourcePath, "#!/bin/sh\nprintf '999.0.0-dev.test\\n'\n");
  await chmod(sourcePath, 0o755);
  await Bun.write(join(dotfilesPath, ".generated/bin/devhost"), `TOOL_EXECUTABLE="${binaryPath}"\n`);
  const cliPath = join(directoryPath, "commands/dotfiles");
  await Bun.write(
    cliPath,
    `#!${process.execPath}
const args = process.argv.slice(2);
const root = process.cwd();
if (args.includes("--help")) {
  console.log(await Bun.file(root + "/help").text());
  process.exit(0);
}
if (args[0] === "tool" && args[1] === "dev" && args[2] === "use") {
  if (await Bun.file(root + "/fail-use").exists()) {
    console.error("registration refused");
    process.exit(1);
  }
  await Bun.write(root + "/invocation.json", JSON.stringify({ args, cwd: root }));
  const source = args[args.indexOf("--bin") + 1].slice("devhost=".length);
  await Bun.write(root + "/.state/custom-dev-tools/devhost", Bun.file(source));
  const { chmod } = await import("node:fs/promises");
  await chmod(root + "/.state/custom-dev-tools/devhost", 0o755);
} else if (args[0] === "tool" && args[1] === "which" && args.includes("--bin")) {
  console.log(root + "/.state/custom-dev-tools/devhost");
} else {
  console.error("unexpected command");
  process.exit(1);
}
`,
  );
  await chmod(cliPath, 0o755);
  await Bun.write(join(dotfilesPath, "help"), "Usage: tool dev use <tool> --bin name=source");
  previousPath = process.env.PATH ?? "";
  process.env.PATH = join(directoryPath, "commands") + ":" + (previousPath ?? "");
});

afterEach(async () => {
  process.env.PATH = previousPath;
  await rm(directoryPath, { recursive: true, force: true });
});

describe("devBootstrap", () => {
  it("builds and registers a binary stamped with the checkout's development version", async () => {
    const repositoryPath = resolve(import.meta.dir, "../../../..");
    const revision = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], { cwd: repositoryPath });
    const revisionText = (await new Response(revision.stdout).text()).trim();
    expect(await revision.exited).toBe(0);
    const release = Bun.spawn(["git", "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], {
      cwd: repositoryPath,
      stderr: "ignore",
    });
    const releaseTag = (await new Response(release.stdout).text()).trim();
    expect(await release.exited).toBe(0);
    expect(releaseTag).toMatch(/^v\d/);
    const releaseText = releaseTag.slice(1);
    const bootstrap = Bun.spawn(["just", "dev-bootstrap", dotfilesPath], {
      cwd: repositoryPath,
      env: process.env,
      stdout: "pipe",
      stderr: "inherit",
    });
    await new Response(bootstrap.stdout).text();
    expect(await bootstrap.exited).toBe(0);
    expect(await Bun.file(binaryPath).text()).toBe("managed release");
    const installed = Bun.spawn([developmentPath, "--version"]);
    expect(await new Response(installed.stdout).text()).toBe(`999.0.0-dev--${releaseText}+${revisionText}\n`);
    expect(await installed.exited).toBe(0);
  }, 120_000);

  it("registers the build and resolves its configured development path without overwriting the release", async () => {
    expect(await devBootstrap(sourcePath, dotfilesPath)).toBe(developmentPath);
    expect(await Bun.file(binaryPath).text()).toBe("managed release");
    expect(await Bun.file(developmentPath).text()).toBe(await Bun.file(sourcePath).text());
    const invocation = await Bun.file(join(dotfilesPath, "invocation.json")).json();
    expect(invocation.cwd).toBe(dotfilesPath);
    expect(invocation.args).toEqual([
      "tool",
      "dev",
      "use",
      "devhost",
      "--bin",
      "devhost=" + sourcePath,
      "--source-repo",
      resolve(import.meta.dir, "../../../.."),
      "--version",
      "999.0.0-dev.test",
    ]);
  });

  it("works before any release payload or shim exists", async () => {
    await rm(join(dotfilesPath, ".generated"), { recursive: true });
    expect(await devBootstrap(sourcePath, dotfilesPath)).toBe(developmentPath);
    expect(await Bun.file(developmentPath).exists()).toBe(true);
  });

  it("requires a dotfiles CLI with development override support", async () => {
    await Bun.write(join(dotfilesPath, "help"), "Usage: tool");
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow("Update dotfiles");
    expect(await Bun.file(binaryPath).text()).toBe("managed release");
    expect(await Bun.file(join(dotfilesPath, "invocation.json")).exists()).toBe(false);
  });

  it("reports failed registration without falling back to replacing the release", async () => {
    await Bun.write(join(dotfilesPath, "fail-use"), "");
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow("registration refused");
    expect(await Bun.file(binaryPath).text()).toBe("managed release");
    expect(await Bun.file(developmentPath).exists()).toBe(false);
  });

  it("rejects missing and empty build output before registration", async () => {
    await expect(devBootstrap(join(directoryPath, "missing"), dotfilesPath)).rejects.toThrow();
    await Bun.write(sourcePath, "");
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow("Build output is empty");
    expect(await Bun.file(join(dotfilesPath, "invocation.json")).exists()).toBe(false);
  });
});
