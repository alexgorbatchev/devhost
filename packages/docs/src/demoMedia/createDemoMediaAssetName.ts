import { extname } from "node:path";

// A release asset is never replaced: new content gets a new name, so every commit's pins keep resolving.
export function createDemoMediaAssetName(name: string, sha256: string): string {
  const extension = extname(name);
  return `${name.slice(0, -extension.length)}-${sha256.slice(0, 16)}${extension}`;
}
