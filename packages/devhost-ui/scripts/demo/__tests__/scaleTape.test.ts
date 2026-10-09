import { expect, it } from "bun:test";
import { scaleTape } from "../scaleTape";

const tape = [
  'Output "raw/startup.mp4"',
  "Set Width 1280",
  "Set Height 720",
  "Set FontSize 22",
  "Set Padding 32",
  "Set Framerate 30",
  "Set TypingSpeed 65ms",
  'Type "devhost start"',
  "Sleep 6s",
].join("\n");

it("multiplies the terminal's pixel dimensions and leaves its timing alone", () => {
  expect(scaleTape(tape, 2)).toBe(
    [
      'Output "raw/startup.mp4"',
      "Set Width 2560",
      "Set Height 1440",
      "Set FontSize 44",
      "Set Padding 64",
      "Set Framerate 30",
      "Set TypingSpeed 65ms",
      'Type "devhost start"',
      "Sleep 6s",
    ].join("\n"),
  );
});

it("returns the tape unchanged at the recording's own size", () => {
  expect(scaleTape(tape, 1)).toBe(tape);
});

it("rejects a scale that would produce fractional pixels", () => {
  expect(() => scaleTape(tape, 1.5)).toThrow("Tape scale must be a positive integer");
});
