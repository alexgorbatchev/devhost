import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import { generatePromoAudio } from "../generatePromoAudio";
import { runCommand } from "../runCommand";
import type { IPromoAudioApi, IPromoAudioTimings } from "../types";

let directoryPath = "";
let speech = new Uint8Array();

const narration = {
  voice: { id: "voice-123", name: "Narrator", model: "speech-model", stability: 0.4, similarityBoost: 0.7, style: 0.2 },
  lines: [
    { id: "line-1", text: "Which port?" },
    { id: "line-2", text: "Stop juggling ports." },
  ],
  music: {
    model: "music_v2",
    sections: [
      { name: "Intro", seconds: 3.5, styles: ["sparse", "tense"], avoid: ["vocals"] },
      { name: "Resolve", seconds: 8, styles: ["bright", "final hit"], avoid: ["vocals"] },
    ],
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
    // The SDK hands back a script-driven stream, which is what once stalled the file write.
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

beforeAll(async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  directoryPath = await mkdtemp(join(parentPath, "audio-"));
  const speechPath = join(directoryPath, "speech.mp3");
  await runCommand(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", speechPath]);
  speech = await Bun.file(speechPath).bytes();
});

afterAll(async () => {
  await rm(directoryPath, { recursive: true, force: true });
});

it("speaks every narration line in its own file and records measured timings", async () => {
  const projectPath = await createProject("all");
  const api = createApi();

  await generatePromoAudio(projectPath, "all", api);

  expect(api.speak).toHaveBeenCalledTimes(2);
  expect(api.speak).toHaveBeenNthCalledWith(1, "voice-123", {
    text: "Which port?",
    modelId: "speech-model",
    outputFormat: "mp3_44100_128",
    voiceSettings: { stability: 0.4, similarityBoost: 0.7, style: 0.2 },
    previousText: undefined,
    nextText: "Stop juggling ports.",
  });
  expect(api.speak).toHaveBeenNthCalledWith(2, "voice-123", {
    text: "Stop juggling ports.",
    modelId: "speech-model",
    outputFormat: "mp3_44100_128",
    voiceSettings: { stability: 0.4, similarityBoost: 0.7, style: 0.2 },
    previousText: "Which port?",
    nextText: undefined,
  });
  expect(api.compose).toHaveBeenCalledTimes(1);
  expect(api.compose).toHaveBeenCalledWith({
    modelId: "music_v2",
    compositionPlan: {
      chunks: [
        { text: "[Intro]", durationMs: 3_500, positiveStyles: ["sparse", "tense"], negativeStyles: ["vocals"] },
        { text: "[Resolve]", durationMs: 8_000, positiveStyles: ["bright", "final hit"], negativeStyles: ["vocals"] },
      ],
    },
  });
  expect(await Bun.file(join(projectPath, "assets/audio/voice/line-2.mp3")).bytes()).toEqual(speech);
  expect(await Bun.file(join(projectPath, "assets/audio/music.mp3")).bytes()).toEqual(speech);
  const timings: IPromoAudioTimings = await Bun.file(join(projectPath, "assets/audio/timings.json")).json();
  expect(timings.lines.map((line) => ({ id: line.id, path: line.path, words: line.words }))).toEqual([
    { id: "line-1", path: "assets/audio/voice/line-1.mp3", words: [{ text: "OK", start: 0, end: 0.25 }] },
    { id: "line-2", path: "assets/audio/voice/line-2.mp3", words: [{ text: "OK", start: 0, end: 0.25 }] },
  ]);
  expect(timings.lines[0]?.duration).toBeCloseTo(0.5, 1);
  expect(timings.music?.path).toBe("assets/audio/music.mp3");
  expect(timings.music?.duration).toBeCloseTo(0.5, 1);
}, 30_000);

it("regenerates only the music and keeps the recorded voice timings", async () => {
  const projectPath = await createProject("music-only");
  await generatePromoAudio(projectPath, "voice", createApi());
  const voiceOnly: IPromoAudioTimings = await Bun.file(join(projectPath, "assets/audio/timings.json")).json();
  const api = createApi();

  await generatePromoAudio(projectPath, "music", api);

  expect(voiceOnly.music).toBeUndefined();
  expect(api.speak).toHaveBeenCalledTimes(0);
  expect(api.compose).toHaveBeenCalledTimes(1);
  const timings: IPromoAudioTimings = await Bun.file(join(projectPath, "assets/audio/timings.json")).json();
  expect(timings.lines).toEqual(voiceOnly.lines);
  expect(timings.music?.path).toBe("assets/audio/music.mp3");
}, 30_000);

it("rejects a narration without spoken lines before requesting any audio", async () => {
  const projectPath = join(directoryPath, "empty");
  await Bun.write(join(projectPath, "narration.json"), JSON.stringify({ ...narration, lines: [] }));
  const api = createApi();

  await expect(generatePromoAudio(projectPath, "all", api)).rejects.toThrow("narration.json is invalid");
  expect(api.speak).toHaveBeenCalledTimes(0);
  expect(api.compose).toHaveBeenCalledTimes(0);
});
