import assert from "node:assert/strict";
import { resolve } from "node:path";
import { expect, it } from "bun:test";
import { createGuideComposition } from "../createGuideComposition";
import { createPromoCaptions } from "../createPromoCaptions";
import { planGuideFilm } from "../planGuideFilm";
import { readPromoFootageSlots } from "../readPromoFootageSlots";
import type { IGuideFilm, IPromoLineTiming, IPromoWord, IVolumePoint } from "../types";

const template = await Bun.file(resolve(import.meta.dir, "../guide/index.html")).text();

function createLine(id: string, words: IPromoWord[]): IPromoLineTiming {
  return {
    id,
    path: `assets/audio/voice/${id}.mp3`,
    duration: (words.at(-1)?.end ?? 0) + 0.2,
    words,
  };
}

const introLine = createLine("intro", [
  { text: "See", start: 0, end: 0.2 },
  { text: "your", start: 0.25, end: 0.4 },
  { text: "stack.", start: 0.45, end: 0.8 },
]);
const overviewLine = createLine("overview-1", [
  { text: "Hover", start: 0, end: 0.4 },
  { text: "the", start: 0.45, end: 0.55 },
  { text: "minimap.", start: 0.6, end: 1.2 },
]);
const queryLine = createLine("query-1", [
  { text: "Query", start: 0, end: 0.5 },
  { text: "devtools.", start: 0.6, end: 1.3 },
]);
const lines = [introLine, overviewLine, queryLine];

const film: IGuideFilm = {
  title: "Devtools",
  address: "demo.localhost",
  plan: planGuideFilm({ text: "See your stack.", narrationSeconds: 1 }, [
    {
      clip: "overview-1",
      text: "Hover the minimap.",
      footage: { sourceId: "overview-1" },
      sourceSeconds: 6,
      narrationSeconds: 1.4,
    },
    {
      clip: "query-1",
      text: "Query devtools.",
      footage: { sourceId: "query-1" },
      sourceSeconds: 4,
      narrationSeconds: 1.5,
    },
  ]),
  lines,
};

async function readAttributes(
  html: string,
  selector: string,
  names: string[],
): Promise<Record<string, string | null>[]> {
  const found: Record<string, string | null>[] = [];
  await new HTMLRewriter()
    .on(selector, {
      element: (element): void => {
        found.push(Object.fromEntries(names.map((name) => [name, element.getAttribute(name)])));
      },
    })
    .transform(new Response(html))
    .text();
  return found;
}

it("gives the film the length of its plan and one footage slot per clip, in order", async () => {
  const html = await createGuideComposition(template, film);

  expect(await readAttributes(html, "#root", ["data-duration"])).toEqual([{ "data-duration": "14.2" }]);
  expect(await readPromoFootageSlots(html)).toEqual([
    {
      id: "clip-overview-1",
      sourceId: "overview-1",
      outputPath: "assets/footage/clip-overview-1.mp4",
      duration: 6,
      from: 0,
      to: undefined,
    },
    {
      id: "clip-query-1",
      sourceId: "query-1",
      outputPath: "assets/footage/clip-query-1.mp4",
      duration: 4,
      from: 0,
      to: undefined,
    },
  ]);
  expect(await readAttributes(html, "video", ["data-start"])).toEqual([
    { "data-start": "2.4" },
    { "data-start": "8.4" },
  ]);
});

it("cuts a terminal guide's one recording into the windows of its steps", async () => {
  const html = await createGuideComposition(template, {
    title: "Stack lifecycle",
    address: "terminal",
    plan: planGuideFilm({ text: "See your stack.", narrationSeconds: 1 }, [
      {
        clip: "step-1",
        text: "Hover the minimap.",
        footage: { sourceId: "guide", from: 0, to: 3.5 },
        sourceSeconds: 3.5,
        narrationSeconds: 1.4,
      },
      {
        clip: "step-2",
        text: "Query devtools.",
        footage: { sourceId: "guide", from: 3.5, to: 9 },
        sourceSeconds: 5.5,
        narrationSeconds: 1.5,
      },
    ]),
    lines: [introLine, { ...overviewLine, id: "step-1" }, { ...queryLine, id: "step-2" }],
  });

  expect(
    (await readPromoFootageSlots(html)).map((slot) => [slot.id, slot.sourceId, slot.from, slot.to, slot.duration]),
  ).toEqual([
    ["clip-step-1", "guide", 0, 3.5, 3.5],
    ["clip-step-2", "guide", 3.5, 9, 5.5],
  ]);
});

it("speaks the intro over the title card and each line just after its clip starts, so the captions follow the voice", async () => {
  const html = await createGuideComposition(template, film);

  expect(
    await readAttributes(html, "audio[data-narration]", ["data-narration", "src", "data-start", "data-duration"]),
  ).toEqual([
    { "data-narration": "intro", src: "assets/audio/voice/intro.mp3", "data-start": "0.35", "data-duration": "1" },
    {
      "data-narration": "overview-1",
      src: "assets/audio/voice/overview-1.mp3",
      "data-start": "2.55",
      "data-duration": "1.4",
    },
    {
      "data-narration": "query-1",
      src: "assets/audio/voice/query-1.mp3",
      "data-start": "8.55",
      "data-duration": "1.5",
    },
  ]);
  expect(
    await createPromoCaptions(
      html,
      [
        { id: "intro", text: film.plan.intro.text },
        ...film.plan.beats.map((beat) => ({ id: beat.clip, text: beat.text })),
      ],
      { lines },
    ),
  ).toBe(
    [
      "1\n00:00:00,350 --> 00:00:01,350\nSee your stack.\n",
      "2\n00:00:02,550 --> 00:00:03,950\nHover the minimap.\n",
      "3\n00:00:08,550 --> 00:00:10,050\nQuery devtools.\n",
    ].join("\n"),
  );
});

it("shows each line as a caption while its card or clip is on screen, with the time each word is spoken", async () => {
  const html = await createGuideComposition(template, film);

  expect((await readAttributes(html, ".guide-cue", ["id"])).map((cue) => cue.id)).toEqual([
    "cue-intro",
    "cue-overview-1",
    "cue-query-1",
  ]);
  expect((await readAttributes(html, ".guide-word", ["id"])).map((word) => word.id)).toEqual([
    "cue-intro-w0",
    "cue-intro-w1",
    "cue-intro-w2",
    "cue-overview-1-w0",
    "cue-overview-1-w1",
    "cue-overview-1-w2",
    "cue-query-1-w0",
    "cue-query-1-w1",
  ]);
  const data = /window\.__guideFilm = (.*);/.exec(html)?.[1];
  assert(data);
  expect(JSON.parse(data)).toEqual({
    duration: 14.2,
    introSeconds: 2.4,
    outroSeconds: 1.8,
    cuts: [8.4],
    cues: [
      // The intro's caption leaves with the title card; a clip's caption stays until its clip ends.
      { cue: "cue-intro", cueStart: 0.3, cueEnd: 2.4, words: [0.35, 0.6, 0.8] },
      { cue: "cue-overview-1", cueStart: 2.5, cueEnd: 8.4, words: [2.55, 3, 3.15] },
      { cue: "cue-query-1", cueStart: 8.5, cueEnd: 12.4, words: [8.55, 9.15] },
    ],
  });
});

async function readMusicPoints(html: string): Promise<IVolumePoint[]> {
  const [music] = await readAttributes(html, "#music", ["data-automation"]);
  assert(music?.["data-automation"]);
  // The rewriter reports an attribute as it is written in the markup, with its quotes as entities.
  return JSON.parse(music["data-automation"].replaceAll("&quot;", '"')).lanes[0].points;
}

it("lowers the music under each line, brings it back in a long pause, and fades it out with the film", async () => {
  const html = await createGuideComposition(template, film);

  expect(await readAttributes(html, "#music", ["data-duration"])).toEqual([{ "data-duration": "14.2" }]);
  expect(await readMusicPoints(html)).toEqual([
    { t: 0, v: 0.3 },
    // The intro is spoken from 0.35s to 1.35s.
    { t: 0.25, v: 0.3 },
    { t: 0.55, v: 0.1 },
    { t: 1.45, v: 0.1 },
    // The first clip's line follows after 1.2s, too soon for the music to come back: 2.55s to 3.95s.
    { t: 2.45, v: 0.1 },
    { t: 2.75, v: 0.1 },
    { t: 4.05, v: 0.1 },
    // The second clip's line is 4.6s away, so the music returns until it starts: 8.55s to 10.05s.
    { t: 4.65, v: 0.24 },
    { t: 8.45, v: 0.24 },
    { t: 8.75, v: 0.1 },
    { t: 10.15, v: 0.1 },
    { t: 10.75, v: 0.24 },
    // The end card starts at 12.4s and the film ends at 14.2s.
    { t: 12.4, v: 0.24 },
    { t: 12.7, v: 0.34 },
    { t: 13.4, v: 0.34 },
    { t: 14.2, v: 0 },
  ]);
});
it("rejects a clip name that cannot be written into the composition's markup", async () => {
  await expect(
    createGuideComposition(template, {
      ...film,
      plan: planGuideFilm({ text: "See your stack.", narrationSeconds: 1 }, [
        {
          clip: 'step"1',
          text: "Hover the minimap.",
          footage: { sourceId: "guide" },
          sourceSeconds: 5,
          narrationSeconds: 1.4,
        },
      ]),
      lines: [introLine, { ...overviewLine, id: 'step"1' }],
    }),
  ).rejects.toThrow('A clip name must be lowercase letters, digits and hyphens: step"1');
});

it("writes the guide's title and narration as text, whatever characters they hold", async () => {
  const html = await createGuideComposition(template, {
    title: "Hosts & <ports>",
    address: "terminal",
    plan: planGuideFilm({ text: "See your stack.", narrationSeconds: 1 }, [
      {
        clip: "step-1",
        text: "Use <host> & port.",
        footage: { sourceId: "guide" },
        sourceSeconds: 5,
        narrationSeconds: 1,
      },
    ]),
    lines: [
      introLine,
      createLine("step-1", [
        { text: "Use", start: 0, end: 0.2 },
        { text: "<host>", start: 0.3, end: 0.5 },
        { text: "&", start: 0.55, end: 0.6 },
        { text: "port.", start: 0.65, end: 0.9 },
      ]),
    ],
  });

  const texts: string[] = [];
  await new HTMLRewriter()
    .on("#title-text, #stage-title, #stage-address, #cue-step-1 .guide-word", {
      text: (chunk): void => {
        texts.push(chunk.text);
      },
    })
    .transform(new Response(html))
    .text();
  expect(texts.filter((text) => text.trim() !== "")).toEqual([
    "terminal",
    "Hosts &amp; &lt;ports&gt;",
    "Hosts &amp; &lt;ports&gt;",
    "Use",
    "&lt;host&gt;",
    "&amp;",
    "port.",
  ]);
});

it("rejects word timings that are not those of the line's text", async () => {
  await expect(
    createGuideComposition(template, {
      ...film,
      lines: [introLine, createLine("overview-1", [{ text: "Hover", start: 0, end: 0.4 }]), queryLine],
    }),
  ).rejects.toThrow("The audio of overview-1 times 1 words, but its line has 3: generate the guide audio again");
});

it("rejects a line that has no narration audio", async () => {
  await expect(createGuideComposition(template, { ...film, lines: [introLine, overviewLine] })).rejects.toThrow(
    "No narration audio for query-1: generate the guide audio",
  );
});
