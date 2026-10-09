import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createDemoMediaAssetName } from "./createDemoMediaAssetName";
import { hashFile } from "./hashFile";
import { inspectDemoMedia } from "./inspectDemoMedia";
import { readDemoMediaManifest } from "./readDemoMediaManifest";
import type { IDemoMediaManifest, IDemoMediaPin, IPublishDemoMediaOptions, RunCommand } from "./types";

interface IUpload {
  name: string;
  asset: string;
  pin: IDemoMediaPin;
}

// Maps each asset the release finished receiving to the digest GitHub computed for it.
async function readReleaseDigests(manifest: IDemoMediaManifest, run: RunCommand): Promise<Map<string, string>> {
  const output = await run([
    "gh",
    "release",
    "view",
    manifest.release,
    "--repo",
    manifest.repository,
    "--json",
    "assets",
  ]);
  const release: unknown = JSON.parse(output);
  const digests = new Map<string, string>();
  if (typeof release !== "object" || release === null || !("assets" in release) || !Array.isArray(release.assets)) {
    throw new Error(`Release ${manifest.release} of ${manifest.repository} did not list its assets`);
  }
  for (const asset of release.assets) {
    if (typeof asset !== "object" || asset === null || !("name" in asset) || typeof asset.name !== "string") continue;
    if (!("state" in asset) || asset.state !== "uploaded") continue;
    if ("digest" in asset && typeof asset.digest === "string") digests.set(asset.name, asset.digest);
  }
  return digests;
}

export async function publishDemoMedia(options: IPublishDemoMediaOptions): Promise<string[]> {
  const { manifestPath, directoryPath, stagingPath, run } = options;
  const manifest = await readDemoMediaManifest(manifestPath);
  const uploads: IUpload[] = [];
  for (const { name, state } of await inspectDemoMedia(manifest, directoryPath)) {
    // A pinned video that is not on disk keeps its pin: a checkout need not hold every video to publish one.
    if (state !== "different" && state !== "unpinned") continue;
    const path = join(directoryPath, name);
    const pin: IDemoMediaPin = { sha256: await hashFile(path), bytes: Bun.file(path).size };
    uploads.push({ name, asset: createDemoMediaAssetName(name, pin.sha256), pin });
  }
  if (uploads.length === 0) return [];

  const held = await readReleaseDigests(manifest, run);
  // An asset is named after its content, so one the release already holds needs no second upload.
  const missing = uploads.filter((upload) => !held.has(upload.asset));
  let digests = held;
  if (missing.length > 0) {
    try {
      // `gh` names an asset after the file it reads, so each upload is staged under its asset name.
      for (const upload of missing) {
        await Bun.write(join(stagingPath, upload.asset), Bun.file(join(directoryPath, upload.name)));
      }
      const staged = missing.map((upload) => join(stagingPath, upload.asset));
      await run(["gh", "release", "upload", manifest.release, ...staged, "--repo", manifest.repository]);
    } finally {
      await rm(stagingPath, { recursive: true, force: true });
    }
    digests = await readReleaseDigests(manifest, run);
  }

  // A pin is written only for content the release reports holding, byte for byte.
  for (const upload of uploads) {
    const digest = digests.get(upload.asset);
    if (digest === undefined) {
      throw new Error(`Release ${manifest.release} does not hold ${upload.asset} after the upload`);
    }
    if (digest !== `sha256:${upload.pin.sha256}`) {
      throw new Error(
        `Release ${manifest.release} holds ${upload.asset} as ${digest}, not sha256:${upload.pin.sha256}`,
      );
    }
  }
  const files = { ...manifest.files };
  for (const upload of uploads) files[upload.name] = upload.pin;
  const pinned: IDemoMediaManifest = {
    ...manifest,
    files: Object.fromEntries(Object.entries(files).sort(([first], [second]) => first.localeCompare(second))),
  };
  await Bun.write(manifestPath, `${JSON.stringify(pinned, null, 2)}\n`);
  return uploads.map((upload) => upload.name);
}
