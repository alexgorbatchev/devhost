import type { IGuideStepWindow } from "./types";

// A frame this close to the darkest one shows an empty screen with, at most, the first characters of a command.
const clearedMargin = 0.25;
// Clearing a screen darkens the frame at least this much; text only ever adds brightness while a step runs.
const clearDrop = 0.15;

function round(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
}

// Finds each step of a terminal guide in its one recording. The tape clears the screen out of sight before every
// step, so a step starts at the frame where the picture falls back to an empty screen.
export function findGuideStepWindows(
  brightness: readonly number[],
  frameRate: number,
  steps: number,
): IGuideStepWindow[] {
  if (brightness.length === 0) throw new Error("The terminal recording has no frames");
  const darkest = Math.min(...brightness);
  const cuts: number[] = [];
  for (const [frame, value] of brightness.entries()) {
    const previous = brightness[frame - 1];
    if (previous === undefined) continue;
    if (previous - value >= clearDrop && value <= darkest + clearedMargin) cuts.push(frame);
  }
  if (cuts.length !== steps - 1) {
    throw new Error(
      `The terminal recording clears its screen ${cuts.length} times, but its ${steps} steps need ${steps - 1}`,
    );
  }
  const starts = [0, ...cuts, brightness.length];
  return starts.slice(0, -1).map((start, index) => ({
    from: round(start / frameRate),
    to: round((starts[index + 1] ?? brightness.length) / frameRate),
  }));
}
