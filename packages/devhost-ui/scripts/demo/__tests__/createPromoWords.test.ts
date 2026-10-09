import { expect, it } from "bun:test";
import { createPromoWords } from "../createPromoWords";

it("groups character timings into words from the first character's start to the last one's end", () => {
  expect(
    createPromoWords({
      characters: ["W", "h", "i", "c", "h", " ", " ", "p", "o", "r", "t", "?"],
      characterStartTimesSeconds: [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.32, 0.35, 0.4, 0.45, 0.5, 0.6],
      characterEndTimesSeconds: [0.05, 0.1, 0.15, 0.2, 0.3, 0.32, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7],
    }),
  ).toEqual([
    { text: "Which", start: 0, end: 0.3 },
    { text: "port?", start: 0.35, end: 0.7 },
  ]);
});

it("rejects timings that do not cover every character", () => {
  expect(() =>
    createPromoWords({
      characters: ["O", "K"],
      characterStartTimesSeconds: [0],
      characterEndTimesSeconds: [0.1, 0.2],
    }),
  ).toThrow("Speech alignment has 2 characters but 1 start times and 2 end times");
});
