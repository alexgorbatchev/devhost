import { E2E_TEMPORARY_PATH } from "../../../../../test-support/constants";
import { expect, test } from "bun:test";
import { mkdir, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyNativeReactAsset } from "../verifyNativeReactAsset";

test("missing provisioned assets fail instead of skipping native acceptance", async () => {
  const path = resolve(E2E_TEMPORARY_PATH, crypto.randomUUID(), "missing.crx");
  await expect(verifyNativeReactAsset(path, "0".repeat(64))).rejects.toThrow(
    `Required native asset is missing: ${path}`,
  );
});

test("asset verification reads actual bytes and rejects a changed provisioned asset", async () => {
  const directoryPath = resolve(E2E_TEMPORARY_PATH, `native-asset-${crypto.randomUUID()}`);
  const path = resolve(directoryPath, "asset");
  await mkdir(directoryPath, { recursive: true });
  try {
    await Bun.write(path, "original bytes");
    const expected = new Bun.CryptoHasher("sha256").update("original bytes").digest("hex");
    expect(await verifyNativeReactAsset(path, expected)).toEqual({ path, bytes: 14, sha256: expected });
    await Bun.write(path, "changed bytes");
    const actual = new Bun.CryptoHasher("sha256").update("changed bytes").digest("hex");
    await expect(verifyNativeReactAsset(path, expected)).rejects.toThrow(
      `Native asset SHA256 mismatch: ${path}; expected ${expected}, received ${actual}`,
    );
  } finally {
    await Bun.file(path).delete();
    await rmdir(directoryPath);
  }
});
