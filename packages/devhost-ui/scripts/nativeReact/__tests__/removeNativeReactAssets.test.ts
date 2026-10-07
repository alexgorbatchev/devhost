import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { lstat, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { removeNativeReactAssets } from "../removeNativeReactAssets";

test("partial native extraction is hashed before the whole owned directory is removed", async () => {
  const outputPath = resolve(".tmp", `native-extraction-${crypto.randomUUID()}`);
  const directoryPath = resolve(outputPath, "assets");
  const filePath = resolve(directoryPath, "chrome", "partial");
  await mkdir(resolve(directoryPath, "chrome"), { recursive: true });
  await Bun.write(filePath, "partial extraction");
  try {
    await removeNativeReactAssets(directoryPath, outputPath);
    expect(await Bun.file(resolve(outputPath, "extracted-assets-manifest.json")).json()).toEqual([
      {
        path: filePath,
        bytes: 18,
        sha256: new Bun.CryptoHasher("sha256").update("partial extraction").digest("hex"),
      },
    ]);
    expect(await Bun.file(resolve(outputPath, "extracted-assets-cleanup.json")).json()).toEqual({
      directoryPath,
      isAbsent: true,
      files: 1,
    });
    await assert.rejects(lstat(directoryPath), { code: "ENOENT" });
  } finally {
    await rm(outputPath, { recursive: true, force: true });
  }
});
