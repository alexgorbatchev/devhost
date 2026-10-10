import { expect, it } from "bun:test";
import { planGuideFilm } from "../planGuideFilm";
import type { IGuideClipInput } from "../types";

function createClip(clip: string, sourceSeconds: number, narrationSeconds: number): IGuideClipInput {
  return { clip, text: `Line of ${clip}.`, footage: { sourceId: clip }, sourceSeconds, narrationSeconds };
}

it("opens on the title card with the intro line, plays each clip under its own line, and closes on the end card", () => {
  const plan = planGuideFilm({ text: "Route services by path.", narrationSeconds: 1.5 }, [
    createClip("overview-1", 6, 2),
    createClip("overview-2", 5, 3),
  ]);

  expect(plan).toEqual({
    duration: 15.2,
    introSeconds: 2.4,
    outroSeconds: 1.8,
    intro: { text: "Route services by path.", narrationStart: 0.35, narrationSeconds: 1.5 },
    beats: [
      {
        clip: "overview-1",
        text: "Line of overview-1.",
        footage: { sourceId: "overview-1" },
        start: 2.4,
        duration: 6,
        // A line starts just after its clip does.
        narrationStart: 2.55,
        narrationSeconds: 2,
      },
      {
        clip: "overview-2",
        text: "Line of overview-2.",
        footage: { sourceId: "overview-2" },
        start: 8.4,
        duration: 5,
        narrationStart: 8.55,
        narrationSeconds: 3,
      },
    ],
  });
});

it("keeps the title card up until a long intro line has been spoken", () => {
  const plan = planGuideFilm({ text: "A long promise.", narrationSeconds: 4 }, [createClip("guide", 5, 1)]);

  // 0.35 before the line, 4 for it, and a breath of 0.3 after it.
  expect({ introSeconds: plan.introSeconds, firstClip: plan.beats[0]?.start }).toEqual({
    introSeconds: 4.65,
    firstClip: 4.65,
  });
});

it("holds a clip that ends before its line does", () => {
  const plan = planGuideFilm({ text: "Intro.", narrationSeconds: 1 }, [
    createClip("step-1", 2, 6),
    createClip("step-2", 1, 4),
  ]);

  // Each slot outlasts its line by a breath: 0.15 + 6 + 0.3 and 0.15 + 4 + 0.3.
  expect(plan.beats.map((beat) => beat.duration)).toEqual([6.45, 4.45]);
  expect(plan.duration).toBe(15.1);
});

it("plays long footage faster to keep the film within the limit, but never cuts a line short", () => {
  const plan = planGuideFilm({ text: "Intro.", narrationSeconds: 1 }, [
    createClip("step-1", 50, 3),
    createClip("step-2", 10, 8),
  ]);

  expect(plan.duration).toBe(45);
  // The second clip keeps the 8.45 seconds its line needs; the first gives up the rest.
  expect(plan.beats.map((beat) => beat.duration)).toEqual([32.35, 8.45]);
});

it("fits a film to the limit exactly, however the lengths of its clips round", () => {
  // Seven clips share 40.8 seconds: 5.8285... each, which would round up to 5.829 seven times and pass the limit.
  const plan = planGuideFilm(
    { text: "Intro.", narrationSeconds: 1 },
    Array.from({ length: 7 }, (_, index) => createClip(`step-${index + 1}`, 10, 1)),
  );

  expect(plan.duration).toBe(45);
  // Each clip runs from one rounded boundary to the next, and the last one ends where the end card starts.
  expect(plan.beats.map((beat) => beat.start)).toEqual([2.4, 8.229, 14.057, 19.886, 25.714, 31.543, 37.371]);
  expect(plan.beats.map((beat) => beat.duration)).toEqual([5.829, 5.828, 5.829, 5.828, 5.829, 5.828, 5.829]);
});

it("rejects a guide whose narration alone does not fit", () => {
  expect(() =>
    planGuideFilm({ text: "Intro.", narrationSeconds: 1 }, [
      createClip("step-1", 30, 30),
      createClip("step-2", 30, 20),
    ]),
  ).toThrow("The narration needs 55.1s, which is over the 45s a guide film may last");
});

it("rejects a guide without clips", () => {
  expect(() => planGuideFilm({ text: "Intro.", narrationSeconds: 1 }, [])).toThrow(
    "A guide film needs at least one clip",
  );
});
