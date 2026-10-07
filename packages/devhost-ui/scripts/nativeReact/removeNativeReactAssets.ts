import assert from "node:assert/strict";
import { lstat, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Glob } from "bun";
import type { INativeReactAssetProof } from "./types";

export async function removeNativeReactAssets(directoryPath: string, outputPath: string): Promise<void> {
  const proofs: INativeReactAssetProof[] = [];
  for await (const relativePath of new Glob("**/*").scan({ cwd: directoryPath, onlyFiles: true })) {
    const path = resolve(directoryPath, relativePath);
    const bytes = await Bun.file(path).bytes();
    proofs.push({ path, bytes: bytes.byteLength, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
  }
  proofs.sort((left, right) => left.path.localeCompare(right.path));
  await Bun.write(resolve(outputPath, "extracted-assets-manifest.json"), JSON.stringify(proofs, null, 2));
  await rm(directoryPath, { recursive: true, force: true });
  await assert.rejects(lstat(directoryPath), { code: "ENOENT" });
  await Bun.write(
    resolve(outputPath, "extracted-assets-cleanup.json"),
    JSON.stringify({ directoryPath, isAbsent: true, files: proofs.length }, null, 2),
  );
}
