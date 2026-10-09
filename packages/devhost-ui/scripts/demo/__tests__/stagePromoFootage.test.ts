import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readMediaInfo } from "../readMediaInfo";
import { runCommand } from "../runCommand";
import { stagePromoFootage } from "../stagePromoFootage";
import type { IRecordedSourceClip } from "../types";

let directoryPath = "";
let sources: IRecordedSourceClip[] = [];

async function recordSource(id: string, seconds: number): Promise<IRecordedSourceClip> {
  const path = join(directoryPath, `raw/${id}.mp4`);
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=s=320x180:r=25:d=${seconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
  return { id, path, caption: "" };
}

async function writeFrame(projectName: string, videos: string): Promise<string> {
  const projectPath = join(directoryPath, projectName);
  await Bun.write(join(projectPath, "index.html"), '<div id="root" data-composition-id="main"></div>');
  await Bun.write(
    join(projectPath, "compositions/frames/01-demo.html"),
    `<template><div id="root" data-composition-id="01-demo">${videos}</div></template>`,
  );
  return projectPath;
}

beforeAll(async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  directoryPath = await mkdtemp(join(parentPath, "footage-"));
  await mkdir(join(directoryPath, "raw"));
  sources = [await recordSource("long", 6), await recordSource("short", 1)];
});

afterAll(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

it("retimes each requested recording into a clip of exactly its slot length", async () => {
  const projectPath = await writeFrame(
    "retimed",
    `<video id="lapse" src="assets/footage/lapse.mp4" data-footage="long" data-footage-to="-2" data-duration="2"></video>
     <video id="held" src="assets/footage/held.mp4" data-footage="short" data-duration="2.5"></video>`,
  );

  const staged = await stagePromoFootage(projectPath, sources, new AbortController().signal);

  expect(staged).toEqual([
    {
      id: "lapse",
      sourceId: "long",
      outputPath: "assets/footage/lapse.mp4",
      duration: 2,
      from: 0,
      to: -2,
      startSeconds: 0,
      sourceSeconds: 4,
      speed: 2,
      holdSeconds: 0,
    },
    {
      id: "held",
      sourceId: "short",
      outputPath: "assets/footage/held.mp4",
      duration: 2.5,
      from: 0,
      to: undefined,
      startSeconds: 0,
      sourceSeconds: 1,
      speed: 1,
      holdSeconds: 1.5,
    },
  ]);
  const lapse = await readMediaInfo(join(projectPath, "assets/footage/lapse.mp4"));
  const held = await readMediaInfo(join(projectPath, "assets/footage/held.mp4"));
  expect({ width: lapse.width, height: lapse.height }).toEqual({ width: 320, height: 180 });
  expect(lapse.duration).toBeCloseTo(2, 1);
  expect(held.duration).toBeCloseTo(2.5, 1);
  // The renderer seeks into each clip, which needs a keyframe every second rather than one per clip.
  const keyframes = await runCommand([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-skip_frame",
    "nokey",
    "-show_entries",
    "frame=pts_time",
    "-of",
    "csv=p=0",
    join(projectPath, "assets/footage/held.mp4"),
  ]);
  expect(
    keyframes
      .trim()
      .split("\n")
      .map((time) => Number.parseFloat(time)),
  ).toEqual([0, 1, 2]);
}, 30_000);

it("names the frame and the recording when requested footage was not captured", async () => {
  const projectPath = await writeFrame(
    "missing",
    '<video id="query" src="assets/footage/query.mp4" data-footage="query-1" data-duration="2"></video>',
  );

  await expect(stagePromoFootage(projectPath, sources, new AbortController().signal)).rejects.toThrow(
    "compositions/frames/01-demo.html requests footage query-1, which this run did not record",
  );
});
