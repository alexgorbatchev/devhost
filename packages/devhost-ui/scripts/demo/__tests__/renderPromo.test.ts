import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readMediaInfo } from "../readMediaInfo";
import { renderPromo } from "../renderPromo";
import { runCommand } from "../runCommand";
import type { IPromoAudioTimings, RenderPromoComposition } from "../types";

let directoryPath = "";
let projectSourcePath = "";

const timings: IPromoAudioTimings = {
  lines: [{ id: "line-1", path: "assets/audio/voice/line-1.mp3", duration: 1.5, words: [] }],
};

function createRenderer(seconds: number, audio: string[]): RenderPromoComposition {
  return async (projectPath, outputPath): Promise<void> => {
    // The staged project must be complete before the renderer reads it.
    const staged = await readMediaInfo(join(projectPath, "assets/footage/terminal.mp4"));
    await runCommand([
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=navy:s=320x180:r=30:d=${seconds}`,
      ...audio,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      "-metadata",
      `comment=staged ${staged.duration.toFixed(1)}s`,
      outputPath,
    ]);
  };
}

const tone = ["-f", "lavfi", "-i", "sine=frequency=440:duration=60"];

async function createRecording(name: string): Promise<string> {
  const recordingPath = join(directoryPath, name);
  await mkdir(join(recordingPath, "raw"), { recursive: true });
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=s=320x180:r=25:d=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    join(recordingPath, "raw/startup.mp4"),
  ]);
  return recordingPath;
}

beforeAll(async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  directoryPath = await mkdtemp(join(parentPath, "promo-"));
  projectSourcePath = join(directoryPath, "project");
  await Bun.write(
    join(projectSourcePath, "index.html"),
    `<div id="root" data-composition-id="main">
      <video id="terminal" src="assets/footage/terminal.mp4" data-footage="startup" data-duration="2"></video>
      <audio id="voice-line-1" data-narration="line-1" src="assets/audio/voice/line-1.mp3" data-start="0.5"></audio>
    </div>`,
  );
  await Bun.write(
    join(projectSourcePath, "narration.json"),
    JSON.stringify({ lines: [{ id: "line-1", text: "Stop juggling ports." }] }),
  );
  await Bun.write(join(projectSourcePath, "assets/audio/timings.json"), JSON.stringify(timings));
});

afterAll(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

it("stages a private copy of the project and writes the video with its captions and poster", async () => {
  const recordingPath = await createRecording("complete");

  const outputPath = await renderPromo({
    directoryPath: recordingPath,
    projectSourcePath,
    render: createRenderer(4, tone),
    signal: new AbortController().signal,
  });

  expect(outputPath).toBe(join(recordingPath, "devhost-demo.mp4"));
  expect(await Bun.file(join(recordingPath, "devhost-demo.srt")).text()).toBe(
    "1\n00:00:00,500 --> 00:00:02,000\nStop juggling ports.\n",
  );
  expect(
    await runCommand([
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      join(recordingPath, "poster.png"),
    ]),
  ).toBe("320,180\n");
  expect(await Bun.file(join(recordingPath, "promo-footage.json")).json()).toEqual([
    {
      id: "terminal",
      sourceId: "startup",
      outputPath: "assets/footage/terminal.mp4",
      duration: 2,
      from: 0,
      startSeconds: 0,
      sourceSeconds: 3,
      speed: 1.5,
      holdSeconds: 0,
    },
  ]);
  expect(
    await Bun.file(join(recordingPath, "promo/assets/fonts/jetbrains-mono-latin-wght-normal.woff2")).exists(),
  ).toBe(true);
  expect(await Bun.file(join(recordingPath, "promo/assets/vendor/gsap.min.js")).exists()).toBe(true);
  expect(await Bun.file(join(projectSourcePath, "assets/footage/terminal.mp4")).exists()).toBe(false);
}, 30_000);

it("rejects two recordings that a frame could not tell apart", async () => {
  const recordingPath = await createRecording("ambiguous");
  await Bun.write(join(recordingPath, "raw/startup.webm"), "not the terminal recording");

  await expect(
    renderPromo({
      directoryPath: recordingPath,
      projectSourcePath,
      render: createRenderer(4, tone),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("raw/ holds more than one recording named startup");
}, 30_000);

it("rejects a render that runs past the promo's length limit", async () => {
  const recordingPath = await createRecording("too-long");

  await expect(
    renderPromo({
      directoryPath: recordingPath,
      projectSourcePath,
      render: createRenderer(46, tone),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("The promo lasts 46.0s; the limit is 45s");
}, 30_000);

it("rejects a render without the narration and music", async () => {
  const recordingPath = await createRecording("silent");

  await expect(
    renderPromo({
      directoryPath: recordingPath,
      projectSourcePath,
      render: createRenderer(4, []),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("The promo has no audio track");
}, 30_000);
