import { E2E_TEMPORARY_PATH } from "../../../../../test-support/constants";
import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { lstat, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { finishNativeReactCleanup } from "../finishNativeReactCleanup";
import { verifyNativeReactAsset } from "../verifyNativeReactAsset";

test("asset-cleanup rejection retains both the original provisioning error and genuine filesystem failure", async () => {
  const outputPath = resolve(E2E_TEMPORARY_PATH, `native-cleanup-failure-${crypto.randomUUID()}`);
  const directoryPath = resolve(outputPath, "assets");
  const extractedPath = resolve(directoryPath, "partial");
  const missingPath = resolve(outputPath, "missing.zip");
  await mkdir(directoryPath, { recursive: true });
  await mkdir(resolve(outputPath, "extracted-assets-manifest.json"));
  await Bun.write(extractedPath, "retained partial bytes");
  try {
    const primaryError: unknown = await verifyNativeReactAsset(missingPath, "0".repeat(64)).catch(
      (error: unknown) => error,
    );
    assert(primaryError instanceof Error);
    expect(primaryError.message).toBe(`Required native asset is missing: ${missingPath}`);
    const outcome: unknown = await finishNativeReactCleanup(
      directoryPath,
      outputPath,
      primaryError,
      await Promise.allSettled([]),
    ).catch((error: unknown) => error);
    assert(outcome instanceof AggregateError);
    expect(outcome.message).toBe("Native acceptance resource cleanup failed.");
    expect(outcome.errors.length).toBe(2);
    expect(outcome.errors[0]).toBe(primaryError);
    const cleanupError: unknown = outcome.errors[1];
    assert(cleanupError instanceof Error);
    assert("code" in cleanupError);
    expect(cleanupError.code).toBe("EISDIR");
    expect(await Bun.file(extractedPath).text()).toBe("retained partial bytes");
    expect((await lstat(directoryPath)).isDirectory()).toBe(true);
  } finally {
    await rm(outputPath, { recursive: true, force: true });
  }
});
