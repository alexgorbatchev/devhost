import type { INativeReactAssetProof } from "./types";

export async function verifyNativeReactAsset(path: string, expectedSha256: string): Promise<INativeReactAssetProof> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Required native asset is missing: ${path}`);
  const bytes = await file.bytes();
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha256)
    throw new Error(`Native asset SHA256 mismatch: ${path}; expected ${expectedSha256}, received ${sha256}`);
  return { path, bytes: bytes.byteLength, sha256 };
}
