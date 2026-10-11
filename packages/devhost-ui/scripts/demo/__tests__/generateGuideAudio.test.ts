import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import { generateGuideAudio } from "../generateGuideAudio";
import { runCommand } from "../runCommand";
import type { IGuideAudioTimings, IGuideNarration, ISpeechApi } from "../types";

let directoryPath = "";
let speech = new Uint8Array();

const narration: IGuideNarration = {
  voice: { id: "voice-123", name: "Narrator", model: "speech-model", stability: 0.4, similarityBoost: 0.7, style: 0.2 },
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

const allTexts = [
  "See your stack.",
  "Hover the minimap.",
  "Open Query devtools.",
  "Start dependencies first.",
  "Read the manifest.",
];

const rewordedNarration: IGuideNarration = {
  ...narration,
  guides: {
    ...narration.guides,
    devtools: {
      intro: "See your stack.",
      clips: [
        { clip: "overview-1", text: "Hover the minimap." },
        { clip: "query-1", text: "Open the Query panel." },
      ],
    },
  },
};

const shortenedNarration: IGuideNarration = {
  ...narration,
  guides: {
    ...narration.guides,
    devtools: { intro: "See your stack.", clips: [{ clip: "overview-1", text: "Hover the minimap." }] },
  },
};

// Stands in for ElevenLabs and notes the text of each line it is asked to speak.
function createApi(spokenTexts: string[] = []): ISpeechApi {
  return {
    speak: mock<ISpeechApi["speak"]>(async (_voiceId, request) => {
      spokenTexts.push(request.text);
      return {
        audioBase64: Buffer.from(speech).toString("base64"),
        alignment: {
          characters: ["O", "K"],
          characterStartTimesSeconds: [0, 0.1],
          characterEndTimesSeconds: [0.1, 0.25],
        },
      };
    }),
  };
}

// Answers the requests before the given one, then fails that one as ElevenLabs does when the account is spent.
function createApiFailingAt(request: number): ISpeechApi {
  const api = createApi();
  const speak = mock<ISpeechApi["speak"]>(api.speak);
  for (let answered = 1; answered < request; answered += 1) speak.mockImplementationOnce(api.speak);
  speak.mockRejectedValueOnce(new Error("quota exceeded"));
  return { ...api, speak };
}

function writeNarration(projectPath: string, projectNarration: IGuideNarration): Promise<number> {
  return Bun.write(join(projectPath, "narration.json"), JSON.stringify(projectNarration));
}

async function createProject(name: string): Promise<string> {
  const projectPath = join(directoryPath, name);
  await writeNarration(projectPath, narration);
  return projectPath;
}

function readTimings(projectPath: string): Promise<IGuideAudioTimings> {
  return Bun.file(join(projectPath, "assets/audio/timings.json")).json();
}

async function readRecordedLines(projectPath: string): Promise<Record<string, string[]>> {
  const { guides } = await readTimings(projectPath);
  return Object.fromEntries(Object.entries(guides).map(([guide, lines]) => [guide, lines.map((line) => line.id)]));
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

  await generateGuideAudio(projectPath, "all", "keep", api);

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

it("keeps every take whose request has not changed", async () => {
  const projectPath = await createProject("unchanged");
  await generateGuideAudio(projectPath, "all", "keep", createApi());
  const taken = await readTimings(projectPath);
  const api = createApi();

  await generateGuideAudio(projectPath, "all", "keep", api);

  expect(api.speak).not.toHaveBeenCalled();
  expect(await readTimings(projectPath)).toEqual(taken);
});

// A line is requested with its neighbours as context, so a change to a line also changes the requests beside it.
const narrationChanges = [
  {
    change: "a line is reworded",
    name: "reworded",
    changed: rewordedNarration,
    spoken: ["Hover the minimap.", "Open the Query panel."],
    recorded: ["intro", "overview-1", "query-1"],
  },
  {
    change: "a line is removed",
    name: "shortened",
    changed: shortenedNarration,
    spoken: ["Hover the minimap."],
    recorded: ["intro", "overview-1"],
  },
  {
    change: "a voice setting changes",
    name: "steadier",
    changed: { ...narration, voice: { ...narration.voice, stability: 0.9 } },
    spoken: allTexts,
    recorded: ["intro", "overview-1", "query-1"],
  },
  {
    change: "the voice changes",
    name: "revoiced",
    changed: { ...narration, voice: { ...narration.voice, id: "voice-456" } },
    spoken: allTexts,
    recorded: ["intro", "overview-1", "query-1"],
  },
];

it.each(narrationChanges)(
  "speaks only the lines whose request changed when $change",
  async ({ name, changed, spoken, recorded }) => {
    const projectPath = await createProject(name);
    await generateGuideAudio(projectPath, "all", "keep", createApi());
    await writeNarration(projectPath, changed);
    const spokenTexts: string[] = [];

    await generateGuideAudio(projectPath, "all", "keep", createApi(spokenTexts));

    expect(spokenTexts).toEqual(spoken);
    expect(await readRecordedLines(projectPath)).toEqual({
      devtools: recorded,
      "stack-lifecycle": ["intro", "step-1"],
    });
  },
);

it("speaks a line again when its file is gone", async () => {
  const projectPath = await createProject("missing-file");
  await generateGuideAudio(projectPath, "all", "keep", createApi());
  const linePath = join(projectPath, "assets/audio/voice/devtools/overview-1.mp3");
  await rm(linePath);
  const spokenTexts: string[] = [];

  await generateGuideAudio(projectPath, "all", "keep", createApi(spokenTexts));

  expect(spokenTexts).toEqual(["Hover the minimap."]);
  expect(await Bun.file(linePath).bytes()).toEqual(speech);
});

it("retakes every line of one guide and keeps the other guides' takes", async () => {
  const projectPath = await createProject("one");
  await generateGuideAudio(projectPath, "all", "keep", createApi());
  const taken = await readTimings(projectPath);
  const spokenTexts: string[] = [];
  const api = createApi(spokenTexts);

  await generateGuideAudio(projectPath, "stack-lifecycle", "retake", api);

  expect(spokenTexts).toEqual(["Start dependencies first.", "Read the manifest."]);
  expect(await readTimings(projectPath)).toEqual(taken);
});

it("records each take as it is made, so the lines before a failed request are not spoken again", async () => {
  const projectPath = await createProject("failed");

  await expect(generateGuideAudio(projectPath, "all", "keep", createApiFailingAt(3))).rejects.toThrow("quota exceeded");

  expect(await readRecordedLines(projectPath)).toEqual({ devtools: ["intro", "overview-1"] });
  const spokenTexts: string[] = [];
  await generateGuideAudio(projectPath, "all", "keep", createApi(spokenTexts));
  expect(spokenTexts).toEqual(["Open Query devtools.", "Start dependencies first.", "Read the manifest."]);
});

it("forgets a line's take before asking for a new one, so a failed request leaves no timings of a replaced file", async () => {
  const projectPath = await createProject("replaced");
  await generateGuideAudio(projectPath, "all", "keep", createApi());
  await writeNarration(projectPath, rewordedNarration);

  // The reworded line is the second request: the line before it is spoken first, with its new neighbour.
  await expect(generateGuideAudio(projectPath, "all", "keep", createApiFailingAt(2))).rejects.toThrow("quota exceeded");

  expect(await readRecordedLines(projectPath)).toEqual({
    devtools: ["intro", "overview-1"],
    "stack-lifecycle": ["intro", "step-1"],
  });
});

it("generates nothing but the narration", async () => {
  const projectPath = await createProject("narration-only");

  await generateGuideAudio(projectPath, "all", "keep", createApi());

  const audio = await Array.fromAsync(new Bun.Glob("**/*.mp3").scan({ cwd: join(projectPath, "assets/audio") }));
  expect(audio.sort()).toEqual([
    "voice/devtools/intro.mp3",
    "voice/devtools/overview-1.mp3",
    "voice/devtools/query-1.mp3",
    "voice/stack-lifecycle/intro.mp3",
    "voice/stack-lifecycle/step-1.mp3",
  ]);
  expect(Object.keys(await readTimings(projectPath))).toEqual(["guides"]);
});

it("rejects a guide the narration does not have", async () => {
  const projectPath = await createProject("unknown");

  await expect(generateGuideAudio(projectPath, "missing-guide", "keep", createApi())).rejects.toThrow(
    "narration.json has no guide named missing-guide",
  );
});

it("rejects a choice of takes other than keeping or retaking them", async () => {
  const projectPath = await createProject("unknown-takes");
  const api = createApi();

  await expect(generateGuideAudio(projectPath, "all", "sometimes", api)).rejects.toThrow(
    "Choose what happens to the recorded takes: keep, retake",
  );
  expect(api.speak).not.toHaveBeenCalled();
});
