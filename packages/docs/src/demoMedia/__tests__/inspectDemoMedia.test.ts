import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { inspectDemoMedia } from "../inspectDemoMedia";
import { createManifest, createTestDirectory } from "./helpers";

let directoryPath = "";

beforeEach(async () => {
  directoryPath = await createTestDirectory();
});

afterEach(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

it("tells apart a pinned video that is current, missing, or rendered again, and a video nothing pins", async () => {
  await Bun.write(join(directoryPath, "current.mp4"), "published");
  await Bun.write(join(directoryPath, "rendered-again.mp4"), "a new render");
  await Bun.write(join(directoryPath, "new-guide.mp4"), "never published");
  await Bun.write(join(directoryPath, "new-guide.vtt"), "WEBVTT");

  const states = await inspectDemoMedia(
    createManifest({ "current.mp4": "published", "missing.mp4": "published", "rendered-again.mp4": "published" }),
    directoryPath,
  );

  expect(states).toEqual([
    { name: "current.mp4", state: "current" },
    { name: "missing.mp4", state: "missing" },
    { name: "new-guide.mp4", state: "unpinned" },
    { name: "rendered-again.mp4", state: "different" },
  ]);
});

it("reports every pinned video as missing in a checkout that has not downloaded them", async () => {
  const states = await inspectDemoMedia(
    createManifest({ "annotations.mp4": "published", "devtools.mp4": "published" }),
    join(directoryPath, "never-created"),
  );

  expect(states).toEqual([
    { name: "annotations.mp4", state: "missing" },
    { name: "devtools.mp4", state: "missing" },
  ]);
});
