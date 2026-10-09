import { createDemoMediaAssetName } from "./createDemoMediaAssetName";
import type { IDemoMediaManifest, IDemoMediaPin } from "./types";

function isPin(value: unknown): value is IDemoMediaPin {
  return (
    typeof value === "object" &&
    value !== null &&
    "asset" in value &&
    typeof value.asset === "string" &&
    "sha256" in value &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    "bytes" in value &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0
  );
}

function isManifest(value: unknown): value is IDemoMediaManifest {
  if (typeof value !== "object" || value === null) return false;
  if (!("repository" in value && "release" in value && "files" in value)) return false;
  if (typeof value.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(value.repository)) return false;
  if (typeof value.release !== "string" || !/^[\w.-]+$/.test(value.release)) return false;
  if (typeof value.files !== "object" || value.files === null || Array.isArray(value.files)) return false;
  return Object.entries(value.files).every(
    ([name, pin]) =>
      // A file name is joined to the media directory, so it names a video and nothing else.
      /^[a-z0-9][a-z0-9-]*\.mp4$/.test(name) &&
      isPin(pin) &&
      // The asset is named after the content, which keeps a hand-edited pin from pointing at another file.
      pin.asset === createDemoMediaAssetName(name, pin.sha256),
  );
}

export async function readDemoMediaManifest(manifestPath: string): Promise<IDemoMediaManifest> {
  const manifest: unknown = await Bun.file(manifestPath).json();
  if (!isManifest(manifest)) throw new Error(`${manifestPath} is not a demo media manifest`);
  return manifest;
}
