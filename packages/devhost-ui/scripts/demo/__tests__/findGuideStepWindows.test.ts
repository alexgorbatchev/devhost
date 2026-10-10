import { expect, it } from "bun:test";
import { findGuideStepWindows } from "../findGuideStepWindows";

// A terminal frame gets brighter as text is typed and printed, and falls back when the screen is cleared.
function createStep(frames: number, peak: number): number[] {
  return Array.from({ length: frames }, (_, frame) => 36.08 + (peak - 36.08) * (frame / (frames - 1)));
}

it("starts a step at each frame where the screen was cleared", () => {
  const brightness = [...createStep(100, 39.8), ...createStep(28, 36.5), ...createStep(80, 37.7)];

  // At 25 frames a second: the first clear is frame 100, the second frame 128, and the recording has 208 frames.
  expect(findGuideStepWindows(brightness, 25, 3)).toEqual([
    { from: 0, to: 4 },
    { from: 4, to: 5.12 },
    { from: 5.12, to: 8.32 },
  ]);
});

it("does not take a screen that scrolls or loses a line for a cleared one", () => {
  const scrolled = createStep(50, 39);
  // Output scrolls a line off the top: the frame darkens, but the screen is far from empty.
  scrolled[30] = 37;
  const brightness = [...scrolled, ...createStep(50, 38)];

  expect(findGuideStepWindows(brightness, 25, 2)).toEqual([
    { from: 0, to: 2 },
    { from: 2, to: 4 },
  ]);
});

it("does not take an empty screen that dims a little for a cleared one", () => {
  // The prompt on an empty screen is redrawn before the first command: the frame dims, but nothing was cleared.
  const brightness = [36.2, 36.1, ...createStep(48, 39), ...createStep(50, 38)];

  expect(findGuideStepWindows(brightness, 25, 2)).toEqual([
    { from: 0, to: 2 },
    { from: 2, to: 4 },
  ]);
});

it("takes the first typed characters of a step as part of that step", () => {
  // The first frame after a clear already shows two characters of the next command.
  const brightness = [...createStep(50, 39), 36.12, ...createStep(49, 38).slice(1)];

  expect(findGuideStepWindows(brightness, 25, 2).map((window) => window.from)).toEqual([0, 2]);
});

it("rejects a recording that does not show every step on a clean screen", () => {
  const brightness = [...createStep(50, 39), ...createStep(50, 38)];

  expect(() => findGuideStepWindows(brightness, 25, 3)).toThrow(
    "The terminal recording clears its screen 1 times, but its 3 steps need 2",
  );
});

it("rejects a recording without frames", () => {
  expect(() => findGuideStepWindows([], 25, 1)).toThrow("The terminal recording has no frames");
});
