import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { readPromoFootageSlots } from "../readPromoFootageSlots";
import { renderGuideFilm } from "../renderGuideFilm";
import { runCommand } from "../runCommand";
import type { IGuideAudioTimings, IGuideFilmPlan, IGuideLineTiming, RenderPromoComposition } from "../types";

let directoryPath = "";
let filmPath = "";

const narration = {
  voice: { id: "voice-123", name: "Narrator", model: "speech-model", stability: 0.4, similarityBoost: 0.7, style: 0.2 },
  guides: {
    "stack-lifecycle": {
      intro: "Start dependencies first.",
      clips: [
        { clip: "step-1", text: "Read the manifest." },
        { clip: "step-2", text: "Start it." },
      ],
    },
  },
};

function createLine(id: string, words: string[]): IGuideLineTiming {
  return {
    id,
    path: `assets/audio/voice/stack-lifecycle/${id}.mp3`,
    // Only the audio generator reads which request a take answers.
    requestSha256: "0".repeat(64),
    duration: 1,
    words: words.map((text, index) => ({ text, start: index * 0.3, end: index * 0.3 + 0.2 })),
  };
}

const timings: IGuideAudioTimings = {
  guides: {
    "stack-lifecycle": [
      createLine("intro", ["Start", "dependencies", "first."]),
      createLine("step-1", ["Read", "the", "manifest."]),
      createLine("step-2", ["Start", "it."]),
    ],
  },
};

// Stands in for HyperFrames: writes a video as long as the staged composition says it is.
const render: RenderPromoComposition = async (projectPath, outputPath): Promise<void> => {
  const html = await Bun.file(join(projectPath, "index.html")).text();
  const seconds = /id="root"[^>]*data-duration="([\d.]+)"/.exec(html)?.[1];
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=navy:s=320x180:r=30:d=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=60",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-shortest",
    outputPath,
  ]);
};

async function createRun(name: string): Promise<string> {
  const runPath = join(directoryPath, name);
  await mkdir(join(runPath, "raw"), { recursive: true });
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=s=320x180:r=30:d=6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    join(runPath, "raw/guide.mp4"),
  ]);
  return runPath;
}

const steps = [
  { clip: "step-1", footage: { sourceId: "guide", from: 0, to: 3.5 } },
  { clip: "step-2", footage: { sourceId: "guide", from: 3.5, to: 6 } },
];

// The sources a guide film is rendered from: the template, the narration, and the audio these timings describe.
async function createFilm(name: string, filmTimings: IGuideAudioTimings): Promise<string> {
  const path = join(directoryPath, name);
  const tonePath = join(directoryPath, "tone.mp3");
  await Bun.write(join(path, "guide/index.html"), Bun.file(resolve(import.meta.dir, "../guide/index.html")));
  await Bun.write(join(path, "guide/narration.json"), JSON.stringify(narration));
  await Bun.write(join(path, "guide/assets/audio/timings.json"), JSON.stringify(filmTimings));
  for (const line of timings.guides["stack-lifecycle"] ?? []) {
    await Bun.write(join(path, "guide", line.path), Bun.file(tonePath));
  }
  await Bun.write(join(path, "promo/package.json"), '{ "scripts": { "render": "pinned renderer" } }');
  await Bun.write(join(path, "promo/hyperframes.json"), "{}");
  return path;
}

beforeAll(async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  directoryPath = await mkdtemp(join(parentPath, "guide-film-"));
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    join(directoryPath, "tone.mp3"),
  ]);
  filmPath = await createFilm("film", timings);
});

afterAll(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

it("renders a guide's steps under its narration, and keeps when each step plays for its poster", async () => {
  const runPath = await createRun("complete");

  const videoPath = await renderGuideFilm({
    directoryPath: runPath,
    filmPath,
    slug: "stack-lifecycle",
    title: "Stack lifecycle",
    address: "terminal",
    clips: steps,
    render,
    signal: new AbortController().signal,
  });

  expect(videoPath).toBe(join(runPath, "devhost-demo.mp4"));
  const staged = await Bun.file(join(runPath, "guide/index.html")).text();
  // The intro line lasts 1s, so the title card keeps its 2.4s; each step plays for as long as it was recorded.
  expect((await readPromoFootageSlots(staged)).map((slot) => [slot.id, slot.sourceId, slot.from, slot.to])).toEqual([
    ["clip-step-1", "guide", 0, 3.5],
    ["clip-step-2", "guide", 3.5, 6],
  ]);
  expect(await Bun.file(join(runPath, "devhost-demo.srt")).text()).toBe(
    [
      "1\n00:00:00,350 --> 00:00:01,350\nStart dependencies first.\n",
      "2\n00:00:02,550 --> 00:00:03,550\nRead the manifest.\n",
      "3\n00:00:06,050 --> 00:00:07,050\nStart it.\n",
    ].join("\n"),
  );
  // The run keeps what it recorded, so the film can be rendered again from it.
  expect(await Bun.file(join(runPath, "guide.json")).json()).toEqual({
    slug: "stack-lifecycle",
    title: "Stack lifecycle",
    address: "terminal",
    clips: steps,
  });
  const plan: IGuideFilmPlan = await Bun.file(join(runPath, "guide-film.json")).json();
  expect(plan.beats.map((beat) => [beat.clip, beat.start, beat.duration])).toEqual([
    ["step-1", 2.4, 3.5],
    ["step-2", 5.9, 2.5],
  ]);
  expect({
    renderer: await Bun.file(join(runPath, "guide/package.json")).text(),
    // The film is staged with its narration and no other sound.
    audio: (await Array.fromAsync(new Bun.Glob("**/*.mp3").scan({ cwd: join(runPath, "guide/assets/audio") }))).sort(),
    // A guide's run is not taken for a promo render, and the project it was staged from is gone.
    promoFootage: await Bun.file(join(runPath, "promo-footage.json")).exists(),
    source: await Bun.file(join(runPath, "guide-source/index.html")).exists(),
  }).toEqual({
    renderer: '{ "scripts": { "render": "pinned renderer" } }',
    audio: ["voice/intro.mp3", "voice/step-1.mp3", "voice/step-2.mp3"],
    promoFootage: false,
    source: false,
  });
}, 60_000);

it("rejects a recording whose clips are not the ones the narration speaks over", async () => {
  const runPath = await createRun("extra-step");

  await expect(
    renderGuideFilm({
      directoryPath: runPath,
      filmPath,
      slug: "stack-lifecycle",
      title: "Stack lifecycle",
      address: "terminal",
      clips: [...steps, { clip: "step-3", footage: { sourceId: "guide", from: 5, to: 6 } }],
      render,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(
    "The stack-lifecycle guide recorded the clips step-1, step-2, step-3, but its narration has lines for step-1, step-2: " +
      "update guide/narration.json and generate the guide audio",
  );
});

it("rejects a guide whose line has not been spoken yet", async () => {
  const runPath = await createRun("unspoken");
  const unspokenPath = await createFilm("film-unspoken", {
    ...timings,
    guides: { "stack-lifecycle": [createLine("intro", ["Start", "dependencies", "first."])] },
  });

  await expect(
    renderGuideFilm({
      directoryPath: runPath,
      filmPath: unspokenPath,
      slug: "stack-lifecycle",
      title: "Stack lifecycle",
      address: "terminal",
      clips: steps,
      render,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("No narration audio for stack-lifecycle step-1: run `just demo audio-guides`");
});

it("rejects a guide the narration does not have", async () => {
  const runPath = await createRun("unknown");

  await expect(
    renderGuideFilm({
      directoryPath: runPath,
      filmPath,
      slug: "new-guide",
      title: "New guide",
      address: "terminal",
      clips: steps,
      render,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("guide/narration.json has no guide named new-guide");
});
