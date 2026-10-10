import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readFrameBrightness } from "../readFrameBrightness";
import { runCommand } from "../runCommand";

let directoryPath = "";

beforeAll(async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  directoryPath = await mkdtemp(join(parentPath, "brightness-"));
});

afterAll(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

it("measures every frame, so a bright screen followed by a dark one reads as a fall", async () => {
  const videoPath = join(directoryPath, "two-screens.mp4");
  // Five white frames, then five dark ones.
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=64x36:r=10:d=0.5",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x171717:s=64x36:r=10:d=0.5",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    videoPath,
  ]);

  const brightness = await readFrameBrightness(videoPath, new AbortController().signal);

  // On the scale of 0 to 255, a white frame rounds to full brightness and a dark one to none.
  expect(brightness.map((value) => Math.round(value / 255))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
}, 30_000);
