import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import { generateGuideAudio } from "../generateGuideAudio";
import { runCommand } from "../runCommand";
import type { IGuideAudioTimings, IPromoAudioApi } from "../types";

let directoryPath = "";
let speech = new Uint8Array();

const narration = {
  voice: { id: "voice-123", name: "Narrator", model: "speech-model", stability: 0.4, similarityBoost: 0.7, style: 0.2 },
  music: { model: "music_v2", sections: [{ name: "Bed", seconds: 50, styles: ["calm"], avoid: ["vocals"] }] },
  guides: {
    devtools: {
      intro: "See your stack.",
      clips: [
        { clip: "overview-1", text: "Hover the minimap." },
        { clip: "query-1", text: "Open Query devtools." },
      ],
    },
    "stack-lifecycle": { intro: "Start dependencies first.", clips: [{ clip: "step-1", text: "Read the manifest." }] },
  },
};

function createApi(): IPromoAudioApi {
  return {
    speak: mock<IPromoAudioApi["speak"]>(async () => ({
      audioBase64: Buffer.from(speech).toString("base64"),
      alignment: {
        characters: ["O", "K"],
        characterStartTimesSeconds: [0, 0.1],
        characterEndTimesSeconds: [0.1, 0.25],
      },
    })),
    compose: mock<IPromoAudioApi["compose"]>(
      async () =>
        new ReadableStream<Uint8Array>({
          pull: (controller): void => {
            controller.enqueue(speech);
            controller.close();
          },
        }),
    ),
  };
}

async function createProject(name: string): Promise<string> {
  const projectPath = join(directoryPath, name);
  await Bun.write(join(projectPath, "narration.json"), JSON.stringify(narration));
  return projectPath;
}

function readTimings(projectPath: string): Promise<IGuideAudioTimings> {
  return Bun.file(join(projectPath, "assets/audio/timings.json")).json();
}

beforeAll(async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  directoryPath = await mkdtemp(join(parentPath, "guide-audio-"));
  const speechPath = join(directoryPath, "speech.mp3");
  await runCommand(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", speechPath]);
  speech = await Bun.file(speechPath).bytes();
});

afterAll(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

it("speaks every guide's intro and lines into that guide's directory and records their timings by clip", async () => {
  const projectPath = await createProject("all");
  const api = createApi();

  await generateGuideAudio(projectPath, "voice", "all", api);

  expect(api.compose).not.toHaveBeenCalled();
  expect(api.speak).toHaveBeenCalledTimes(5);
  // A line is spoken with its neighbours in the same guide as context, never with another guide's.
  expect(api.speak).toHaveBeenNthCalledWith(1, "voice-123", {
    text: "See your stack.",
    modelId: "speech-model",
    outputFormat: "mp3_44100_128",
    voiceSettings: { stability: 0.4, similarityBoost: 0.7, style: 0.2 },
    previousText: undefined,
    nextText: "Hover the minimap.",
  });
  expect(api.speak).toHaveBeenNthCalledWith(3, "voice-123", {
    text: "Open Query devtools.",
    modelId: "speech-model",
    outputFormat: "mp3_44100_128",
    voiceSettings: { stability: 0.4, similarityBoost: 0.7, style: 0.2 },
    previousText: "Hover the minimap.",
    nextText: undefined,
  });
  expect(await Bun.file(join(projectPath, "assets/audio/voice/devtools/query-1.mp3")).bytes()).toEqual(speech);
  const timings = await readTimings(projectPath);
  expect(
    Object.fromEntries(
      Object.entries(timings.guides).map(([guide, lines]) => [
        guide,
        lines.map((line) => [line.id, line.path, line.words]),
      ]),
    ),
  ).toEqual({
    devtools: [
      ["intro", "assets/audio/voice/devtools/intro.mp3", [{ text: "OK", start: 0, end: 0.25 }]],
      ["overview-1", "assets/audio/voice/devtools/overview-1.mp3", [{ text: "OK", start: 0, end: 0.25 }]],
      ["query-1", "assets/audio/voice/devtools/query-1.mp3", [{ text: "OK", start: 0, end: 0.25 }]],
    ],
    "stack-lifecycle": [
      ["intro", "assets/audio/voice/stack-lifecycle/intro.mp3", [{ text: "OK", start: 0, end: 0.25 }]],
      ["step-1", "assets/audio/voice/stack-lifecycle/step-1.mp3", [{ text: "OK", start: 0, end: 0.25 }]],
    ],
  });
  expect(timings.guides.devtools?.[0]?.duration).toBeCloseTo(0.5, 1);
});

it("speaks one guide again and keeps the other guides' audio and the music", async () => {
  const projectPath = await createProject("one");
  await generateGuideAudio(projectPath, "all", "all", createApi());
  const api = createApi();

  await generateGuideAudio(projectPath, "voice", "stack-lifecycle", api);

  expect(api.speak).toHaveBeenCalledTimes(2);
  expect(api.compose).not.toHaveBeenCalled();
  const timings = await readTimings(projectPath);
  expect({ guides: Object.keys(timings.guides).sort(), music: timings.music?.path }).toEqual({
    guides: ["devtools", "stack-lifecycle"],
    music: "assets/audio/music.mp3",
  });
});

it("composes the shared bed without speaking a line", async () => {
  const projectPath = await createProject("music");
  const api = createApi();

  await generateGuideAudio(projectPath, "music", "all", api);

  expect(api.speak).not.toHaveBeenCalled();
  expect(api.compose).toHaveBeenCalledWith({
    modelId: "music_v2",
    compositionPlan: {
      chunks: [{ text: "[Bed]", durationMs: 50_000, positiveStyles: ["calm"], negativeStyles: ["vocals"] }],
    },
  });
  expect(await Bun.file(join(projectPath, "assets/audio/music.mp3")).bytes()).toEqual(speech);
});

it("rejects a guide the narration does not have", async () => {
  const projectPath = await createProject("unknown");

  await expect(generateGuideAudio(projectPath, "voice", "missing-guide", createApi())).rejects.toThrow(
    "narration.json has no guide named missing-guide",
  );
});
