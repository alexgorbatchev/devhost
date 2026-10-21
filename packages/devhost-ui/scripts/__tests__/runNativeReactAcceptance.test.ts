import { E2E_TEMPORARY_PATH } from "../../../../test-support/constants";
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

test("native runner reports a provisioning failure once and starts no browser or stack", async () => {
  const repositoryRoot = resolve(import.meta.dir, "../../../..");
  const inputPath = resolve(E2E_TEMPORARY_PATH, `native-preflight-${crypto.randomUUID()}`);
  await mkdir(inputPath, { recursive: true });
  // Only Bun is on PATH, so the runner finds no Caddy before it downloads or starts anything.
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../runNativeReactAcceptance.ts")], {
    cwd: repositoryRoot,
    env: { ...process.env, AGENT: "1", TMPDIR: inputPath, PATH: dirname(process.execPath) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const outputMatch = /^Native React acceptance evidence: (.+)$/m.exec(stdout);
  assert(outputMatch !== null, stdout + stderr);
  const outputPath = outputMatch[1];
  assert(outputPath !== undefined);
  try {
    expect(exitCode).toBe(1);
    expect(dirname(outputPath)).toBe(resolve(inputPath, "devhost-e2e", "native-react-acceptance"));
    const reportedErrors = Bun.stripANSI(stderr)
      .split("\n")
      .filter((line) => /^(?:error:|AssertionError:|ENOENT:)/.test(line))
      .map((line) => line.slice(line.indexOf(":") + 1).trimStart());
    expect(reportedErrors).toEqual(["Native React acceptance needs caddy on PATH."]);
    expect((await Bun.file(resolve(outputPath, "failure.log")).text()).split("\n")[0]).toBe(
      "Error: Native React acceptance needs caddy on PATH.",
    );
    expect(await Bun.file(resolve(outputPath, "extracted-assets-manifest.json")).json()).toEqual([]);
    expect(await Bun.file(resolve(outputPath, "extracted-assets-cleanup.json")).json()).toEqual({
      directoryPath: resolve(outputPath, "assets"),
      isAbsent: true,
      files: 0,
    });
    expect(await Bun.file(resolve(outputPath, "cleanup.json")).json()).toEqual({
      cleanup: [{ status: "fulfilled" }],
      browserCleanup: [{ status: "fulfilled" }],
      finalCleanup: [{ status: "fulfilled" }, { status: "fulfilled" }, { status: "fulfilled" }],
      fixturePorts: [null, null],
    });
    await assert.rejects(lstat(resolve(outputPath, "assets")), { code: "ENOENT" });
    await assert.rejects(lstat(resolve(outputPath, "browser-owned.json")), { code: "ENOENT" });
    await assert.rejects(lstat(resolve(outputPath, "stack-ready.json")), { code: "ENOENT" });
  } finally {
    await rm(outputPath, { recursive: true, force: true });
    await rm(inputPath, { recursive: true, force: true });
  }
});
