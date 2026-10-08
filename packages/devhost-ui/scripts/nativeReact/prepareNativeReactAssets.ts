import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  nativeReactChromeArchiveSha256,
  nativeReactChromeVersion,
  nativeReactCrxSha256,
  nativeReactManifestSha256,
  nativeReactExtensionVersion,
  nativeReactAgentVersion,
} from "./constants";
import { verifyNativeReactAsset } from "./verifyNativeReactAsset";
import type { INativeReactProvisioning } from "./types";

interface IPreparedNativeReactAssets {
  chromeExecutablePath: string;
  reactExtensionDirectoryPath: string;
}

const manifestSchema = z.object({
  version: z.literal(nativeReactExtensionVersion),
  devtools_page: z.literal("main.html"),
  background: z.object({ service_worker: z.literal("build/background.js") }),
});

export async function prepareNativeReactAssets(
  input: INativeReactProvisioning,
  outputPath: string,
): Promise<IPreparedNativeReactAssets> {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Provisioned native React acceptance requires the pinned Linux x64 Chrome for Testing archive.");
  const chromeProof = await verifyNativeReactAsset(input.chromeArchivePath, nativeReactChromeArchiveSha256);
  const reactProof = await verifyNativeReactAsset(input.reactCrxPath, nativeReactCrxSha256);
  for (const path of [input.caddyExecutablePath, input.devhostExecutablePath]) {
    if (!(await Bun.file(path).exists())) throw new Error(`Required native executable is missing: ${path}`);
  }
  const agentVersion = Bun.spawnSync(["agent-browser", "--version"], { stdout: "pipe", stderr: "pipe" });
  assert.equal(agentVersion.exitCode, 0, agentVersion.stderr.toString());
  assert.equal(agentVersion.stdout.toString().trim(), nativeReactAgentVersion);
  await mkdir(outputPath, { recursive: true });
  const crx = await Bun.file(input.reactCrxPath).bytes();
  const header = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  // Chromium's CRX3 container precedes the unchanged ZIP payload with magic,
  // version and a little-endian protobuf-header length (crx_verifier.cc).
  assert.equal(new TextDecoder().decode(crx.subarray(0, 4)), "Cr24");
  assert.equal(header.getUint32(4, true), 3);
  const archiveOffset = 12 + header.getUint32(8, true);
  assert(archiveOffset < crx.byteLength);
  const extensionZipPath = resolve(outputPath, "react-extension.zip");
  await Bun.write(extensionZipPath, crx.subarray(archiveOffset));
  const chromeDirectoryPath = resolve(outputPath, "chrome");
  const reactExtensionDirectoryPath = resolve(outputPath, "react-extension");
  for (const [archivePath, directoryPath] of [
    [input.chromeArchivePath, chromeDirectoryPath],
    [extensionZipPath, reactExtensionDirectoryPath],
  ]) {
    assert(archivePath && directoryPath);
    const result = Bun.spawnSync(["unzip", "-q", archivePath, "-d", directoryPath], { stdout: "pipe", stderr: "pipe" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
  }
  const manifestProof = await verifyNativeReactAsset(
    resolve(reactExtensionDirectoryPath, "manifest.json"),
    nativeReactManifestSha256,
  );
  manifestSchema.parse(await Bun.file(manifestProof.path).json());
  const chromeExecutablePath = resolve(chromeDirectoryPath, "chrome-linux64/chrome");
  const versionEnvironment = {
    CHROME_CONFIG_HOME: resolve(outputPath, "version-runtime/chrome-config"),
    XDG_CONFIG_HOME: resolve(outputPath, "version-runtime/config"),
    XDG_CACHE_HOME: resolve(outputPath, "version-runtime/cache"),
    XDG_DATA_HOME: resolve(outputPath, "version-runtime/data"),
    XDG_STATE_HOME: resolve(outputPath, "version-runtime/state"),
  };
  await Promise.all(Object.values(versionEnvironment).map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  const version = Bun.spawnSync([chromeExecutablePath, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...versionEnvironment, TMPDIR: "version-runtime" },
    cwd: outputPath,
  });
  assert.equal(version.exitCode, 0, version.stderr.toString());
  assert.equal(version.stdout.toString().trim(), `Google Chrome for Testing ${nativeReactChromeVersion}`);
  await Bun.write(
    resolve(outputPath, "provisioning-proof.json"),
    JSON.stringify(
      {
        chromeProof,
        reactProof,
        manifestProof,
        browserVersion: version.stdout.toString().trim(),
        agentVersion: agentVersion.stdout.toString().trim(),
        input,
      },
      null,
      2,
    ),
  );
  return { chromeExecutablePath, reactExtensionDirectoryPath };
}
