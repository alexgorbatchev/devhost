import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { IDemoMediaManifest, IDemoMediaPin } from "../types";

export function pin(content: string): IDemoMediaPin {
  return {
    sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
    bytes: new TextEncoder().encode(content).byteLength,
  };
}

export function createManifest(files: Record<string, string>): IDemoMediaManifest {
  return {
    repository: "alexgorbatchev/devhost",
    release: "media",
    files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, pin(content)])),
  };
}

// The first sixteen hexadecimal digits of the content's SHA-256 name its release asset.
export function assetName(stem: string, content: string): string {
  return `${stem}-${pin(content).sha256.slice(0, 16)}.mp4`;
}

export async function createTestDirectory(): Promise<string> {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/docs-demo-media-tests");
  await mkdir(parentPath, { recursive: true });
  return mkdtemp(join(parentPath, "media-"));
}
