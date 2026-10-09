import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { readDemoMediaManifest } from "../readDemoMediaManifest";
import { createManifest, createTestDirectory, hash, pin } from "./helpers";

let manifestPath = "";

beforeEach(async () => {
  manifestPath = join(await createTestDirectory(), "demo-media.json");
});

afterEach(async () => {
  await rm(join(manifestPath, ".."), { recursive: true, force: true });
});

it("reads the release and the pin of every video", async () => {
  const manifest = createManifest({ "annotations.mp4": "annotations video", "stack-lifecycle.mp4": "lifecycle" });
  await Bun.write(manifestPath, JSON.stringify(manifest));

  expect(await readDemoMediaManifest(manifestPath)).toEqual(manifest);
});

it.each([
  ["a list", []],
  ["a repository that is not owner/name", { ...createManifest({}), repository: "devhost" }],
  ["a release tag with a path in it", { ...createManifest({}), release: "media/../v1" }],
  [
    "a file outside the media directory",
    { ...createManifest({}), files: { "../secret.mp4": pin("../secret.mp4", "x") } },
  ],
  ["a file that is not a video", { ...createManifest({}), files: { "annotations.sh": pin("annotations.sh", "x") } }],
  ["a pin without its release asset", { ...createManifest({}), files: { "a.mp4": { sha256: hash("x"), bytes: 1 } } }],
  [
    "an asset that is not named after the video's content",
    { ...createManifest({}), files: { "a.mp4": { ...pin("a.mp4", "x"), asset: "a-0000000000000000.mp4" } } },
  ],
  [
    "a truncated hash",
    { ...createManifest({}), files: { "annotations.mp4": { ...pin("annotations.mp4", "x"), sha256: "abc123" } } },
  ],
  [
    "a size that is not a whole number",
    { ...createManifest({}), files: { "a.mp4": { ...pin("a.mp4", "x"), bytes: 1.5 } } },
  ],
])("rejects %s", async (_name, content) => {
  await Bun.write(manifestPath, JSON.stringify(content));

  await expect(readDemoMediaManifest(manifestPath)).rejects.toThrow(`${manifestPath} is not a demo media manifest`);
});
