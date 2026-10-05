import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { devBootstrap } from "../devBootstrap";

let directoryPath: string;
let dotfilesPath: string;
let binaryPath: string;
let sourcePath: string;
let shimPath: string;

beforeEach(async () => {
  const temporaryRootPath = resolve(import.meta.dir, "../../../..", ".tmp");
  await mkdir(temporaryRootPath, { recursive: true });
  directoryPath = await mkdtemp(join(temporaryRootPath, "dev-bootstrap-"));
  dotfilesPath = join(directoryPath, "dotfiles with spaces");
  binaryPath = join(dotfilesPath, ".generated/binaries/devhost/v0.0.9/devhost");
  sourcePath = join(directoryPath, "build/devhost");
  shimPath = join(dotfilesPath, ".generated/bin/devhost");
  await Bun.write(binaryPath, "old binary");
  await Bun.write(sourcePath, "new binary");
  await Bun.write(shimPath, `#!/bin/sh\nTOOL_EXECUTABLE="${binaryPath}"\nexec "$TOOL_EXECUTABLE" "$@"\n`);
});

afterEach(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

describe("devBootstrap", () => {
  it("builds and installs a binary stamped with the checkout's development version", async () => {
    const repositoryPath = resolve(import.meta.dir, "../../../..");
    const revision = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], { cwd: repositoryPath });
    const revisionText = (await new Response(revision.stdout).text()).trim();
    expect(await revision.exited).toBe(0);
    const bootstrap = Bun.spawn(["just", "dev-bootstrap", dotfilesPath], {
      cwd: repositoryPath,
      stdout: "pipe",
      stderr: "inherit",
    });
    await new Response(bootstrap.stdout).text();
    expect(await bootstrap.exited).toBe(0);
    const installed = Bun.spawn([binaryPath, "--version"]);
    expect(await new Response(installed.stdout).text()).toBe(`999.0.0-dev.${revisionText}\n`);
    expect(await installed.exited).toBe(0);
  });

  it("replaces the shim's versioned payload, preserves the shim, and leaves an executable", async () => {
    const shimText = await Bun.file(shimPath).text();
    expect(await devBootstrap(sourcePath, dotfilesPath)).toBe(binaryPath);
    expect(await Bun.file(binaryPath).text()).toBe("new binary");
    expect(await Bun.file(shimPath).text()).toBe(shimText);
    expect((await stat(binaryPath)).mode & 0o777).toBe(0o755);
    expect(await readdir(resolve(binaryPath, ".."))).toEqual(["devhost"]);
    expect(await readdir(join(dotfilesPath, ".tmp"))).toEqual([]);
  });

  it("replaces a symlink's payload without replacing the link", async () => {
    const linkPath = join(dotfilesPath, ".generated/binaries/devhost/current/devhost");
    await mkdir(resolve(linkPath, ".."), { recursive: true });
    await symlink(binaryPath, linkPath);
    await Bun.write(shimPath, `TOOL_EXECUTABLE="${linkPath}"\n`);
    expect(await devBootstrap(sourcePath, dotfilesPath)).toBe(binaryPath);
    expect(await Bun.file(linkPath).text()).toBe("new binary");
  });

  it("preserves the installed binary when the build output is missing", async () => {
    await expect(devBootstrap(join(directoryPath, "missing"), dotfilesPath)).rejects.toThrow();
    expect(await Bun.file(binaryPath).text()).toBe("old binary");
    expect(await readdir(resolve(binaryPath, ".."))).toEqual(["devhost"]);
  });

  it("rejects an empty build output", async () => {
    await Bun.write(sourcePath, "");
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow("Build output is empty.");
    expect(await Bun.file(binaryPath).text()).toBe("old binary");
  });

  it("rejects a missing installed payload", async () => {
    await Bun.file(binaryPath).delete();
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow();
    expect(await Bun.file(binaryPath).exists()).toBe(false);
  });

  it("rejects shell expressions without executing the shim", async () => {
    await Bun.write(shimPath, 'TOOL_EXECUTABLE="$(touch sentinel)"\n');
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow(
      "Devhost shim must contain one literal, absolute TOOL_EXECUTABLE path.",
    );
    expect(await Bun.file(binaryPath).text()).toBe("old binary");
  });

  it("rejects payloads outside the selected dotfiles directory", async () => {
    await Bun.write(shimPath, `TOOL_EXECUTABLE="${sourcePath}"\n`);
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow(
      "Devhost payload must be inside the dotfiles binaries directory.",
    );
    expect(await Bun.file(sourcePath).text()).toBe("new binary");
  });

  it("rejects multiple executable assignments", async () => {
    await Bun.write(shimPath, `TOOL_EXECUTABLE="${binaryPath}"\nTOOL_EXECUTABLE="${binaryPath}"\n`);
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow(
      "Devhost shim must contain one literal, absolute TOOL_EXECUTABLE path.",
    );
  });

  it("cleans temporary files and preserves the target when replacement fails", async () => {
    await Bun.file(binaryPath).delete();
    await mkdir(binaryPath);
    await expect(devBootstrap(sourcePath, dotfilesPath)).rejects.toThrow();
    expect((await stat(binaryPath)).isDirectory()).toBe(true);
    expect(await readdir(join(dotfilesPath, ".tmp"))).toEqual([]);
  });
});
