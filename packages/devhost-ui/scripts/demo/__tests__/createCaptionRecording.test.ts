import { expect, it, mock } from "bun:test";
import type { ScreencastControls } from "../types";
import { createCaptionRecording } from "../createCaptionRecording";

it("retains each event caption with its own completed video segment", async () => {
  const start = mock(async () => ({
    dispose: async (): Promise<void> => {},
    [Symbol.asyncDispose]: async (): Promise<void> => {},
  }));
  const stop = mock(async (): Promise<void> => {});
  const screencast: ScreencastControls = { start, stop };
  const recording = await createCaptionRecording(screencast, "/recording", "annotations", "Describe the change.");
  await recording.changeCaption("Pi is working.");
  await recording.changeCaption("The heading updated live.");
  expect(await recording.stop()).toEqual([
    { id: "annotations-1", path: "/recording/raw/annotations-1.webm", caption: "Describe the change." },
    { id: "annotations-2", path: "/recording/raw/annotations-2.webm", caption: "Pi is working." },
    { id: "annotations-3", path: "/recording/raw/annotations-3.webm", caption: "The heading updated live." },
  ]);
  expect(start).toHaveBeenCalledTimes(3);
  expect(stop).toHaveBeenCalledTimes(3);
});

it("preserves a single caption for scenes without a transition", async () => {
  const screencast: ScreencastControls = {
    start: async () => ({
      dispose: async (): Promise<void> => {},
      [Symbol.asyncDispose]: async (): Promise<void> => {},
    }),
    stop: async (): Promise<void> => {},
  };
  const recording = await createCaptionRecording(screencast, "/recording", "query", "Inspect the query.");
  expect(await recording.stop()).toEqual([
    { id: "query-1", path: "/recording/raw/query-1.webm", caption: "Inspect the query." },
  ]);
});
