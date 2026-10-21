import { expect, it, mock } from "bun:test";
import { assertDemoFfmpeg } from "../assertDemoFfmpeg";
import type { RunCommand } from "../types";

// Lines in the layout `ffmpeg -encoders` and `ffmpeg -filters` print them.
const fullEncoders = [
  "Encoders:",
  " V..... = Video",
  " ------",
  " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)",
  " V....D libwebp_anim         libwebp WebP image (codec webp)",
  " V....D libwebp              libwebp WebP image (codec webp)",
  " A....D aac                  AAC (Advanced Audio Coding)",
].join("\n");
const fullFilters = [
  "Filters:",
  "  T.. = Timeline support",
  "  ------",
  " .. ass               V->V       Render ASS subtitles onto input video using the libass library.",
  " .. subtitles         V->V       Render text subtitles onto input video using the libass library.",
].join("\n");
// Homebrew's regular ffmpeg formula: H.264 and AAC, but no WebP encoder and no libass filters.
const plainEncoders = [
  "Encoders:",
  " ------",
  " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)",
  " V....D libx264rgb           libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 RGB (codec h264)",
  " A....D aac                  AAC (Advanced Audio Coding)",
].join("\n");
const plainFilters = ["Filters:", "  ------", " TS aap               AA->A      Apply Affine Projection."].join("\n");

function createRunner(encoders: string, filters: string): ReturnType<typeof mock<RunCommand>> {
  // The check lists encoders first, then filters; the first test pins that order.
  return mock<RunCommand>().mockResolvedValueOnce(encoders).mockResolvedValueOnce(filters);
}

it("accepts an FFmpeg build with every encoder and filter the films use", async () => {
  const run = createRunner(fullEncoders, fullFilters);

  await assertDemoFfmpeg(run);

  expect(run.mock.calls.map(([command]) => command)).toEqual([
    ["ffmpeg", "-hide_banner", "-encoders"],
    ["ffmpeg", "-hide_banner", "-filters"],
  ]);
});

it("names each missing encoder and filter, and the build that has them, before anything is recorded", async () => {
  const run = createRunner(plainEncoders, plainFilters);

  await expect(assertDemoFfmpeg(run)).rejects.toThrow(
    "The ffmpeg on PATH lacks the libwebp encoder and the subtitles filter (libass), which the demo films need. " +
      "Use an FFmpeg build with libwebp, libx264, and libass: on macOS, Homebrew's ffmpeg-full, with " +
      '"$(brew --prefix ffmpeg-full)/bin" ahead of other ffmpeg installs on PATH.',
  );
});

it("does not count an encoder whose name only begins with a required one", async () => {
  const run = createRunner(plainEncoders.replace("libx264 ", "libx264xyz "), fullFilters);

  await expect(assertDemoFfmpeg(run)).rejects.toThrow("lacks the libwebp encoder and the libx264 encoder, which");
});
