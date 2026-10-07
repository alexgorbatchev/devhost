import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { lstat, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareNativeReactAssets } from "../nativeReact/prepareNativeReactAssets";
import { readNativeReactProvisioning } from "../nativeReact/readNativeReactProvisioning";

test.each(["missing", "mismatched"])(
  "native runner preserves the %s provisioning failure before extraction",
  async (assetState) => {
    const repositoryRoot = resolve(import.meta.dir, "../../../..");
    const inputPath = resolve(repositoryRoot, ".tmp", `native-preflight-${crypto.randomUUID()}`);
    const chromeArchivePath = resolve(inputPath, `${assetState}.zip`);
    const provisioningPath = resolve(inputPath, "assets.json");
    await mkdir(inputPath, { recursive: true });
    await Bun.write(resolve(inputPath, "mismatched.zip"), "invalid native Chrome archive");
    await Bun.write(
      provisioningPath,
      JSON.stringify({
        chromeArchivePath,
        reactCrxPath: resolve(inputPath, "unprovisioned.crx"),
        caddyExecutablePath: resolve(inputPath, "unprovisioned-caddy"),
        devhostExecutablePath: resolve(inputPath, "unprovisioned-devhost"),
      }),
    );
    const provisioning = await readNativeReactProvisioning(provisioningPath);
    const preparationError: unknown = await prepareNativeReactAssets(provisioning, resolve(inputPath, "assets")).catch(
      (error: unknown) => error,
    );
    assert(preparationError instanceof Error);
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../runNativeReactAcceptance.ts")], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        AGENT: "1",
        TMPDIR: resolve(repositoryRoot, ".tmp"),
        DEVHOST_NATIVE_REACT_ASSETS: provisioningPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const outputMatch = /^Native React acceptance evidence: (.+)$/m.exec(stdout);
    assert(outputMatch !== null);
    const outputPath = outputMatch[1];
    assert(outputPath !== undefined);
    try {
      expect(exitCode).toBe(1);
      const reportedErrors = Bun.stripANSI(stderr)
        .split("\n")
        .filter((line) => /^(?:error:|AssertionError:|ENOENT:)/.test(line))
        .map((line) => line.slice(line.indexOf(":") + 1).trimStart());
      expect(reportedErrors).toEqual([preparationError.message]);
      expect((await Bun.file(resolve(outputPath, "failure.log")).text()).split("\n")[0]).toBe(
        preparationError.stack?.split("\n")[0],
      );
      expect(await Bun.file(resolve(outputPath, "extracted-assets-manifest.json")).json()).toEqual([]);
      expect(await Bun.file(resolve(outputPath, "extracted-assets-cleanup.json")).json()).toEqual({
        directoryPath: resolve(outputPath, "assets"),
        isAbsent: true,
        files: 0,
      });
      expect(await Bun.file(resolve(outputPath, "cleanup.json")).json()).toEqual({
        cleanup: [{ status: "fulfilled" }, { status: "fulfilled" }],
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
  },
);
