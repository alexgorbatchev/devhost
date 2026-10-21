import type { RunCommand } from "./types";

// What the films ask FFmpeg for: the WebP poster, the H.264 and AAC web encode, and burned-in clip captions.
const requiredEncoders = ["libwebp", "libx264", "aac"];
const requiredFilters = [{ name: "subtitles", library: "libass" }];

// Reads the names `ffmpeg -encoders` or `ffmpeg -filters` lists: the word after the flags column of each entry.
function readListedNames(listing: string): Set<string> {
  const names = listing
    .split("\n")
    .map((line) => /^\s*\S+\s+(\S+)\s/.exec(line)?.[1])
    .filter((name) => name !== undefined);
  return new Set(names);
}

// Fails before anything is recorded or rendered when the ffmpeg on PATH cannot make the films. Homebrew's regular
// ffmpeg formula, which other formulas install as a dependency, has no WebP encoder and no libass filters.
export async function assertDemoFfmpeg(run: RunCommand, signal?: AbortSignal): Promise<void> {
  const encoders = readListedNames(await run(["ffmpeg", "-hide_banner", "-encoders"], { signal }));
  const filters = readListedNames(await run(["ffmpeg", "-hide_banner", "-filters"], { signal }));
  const missing = [
    ...requiredEncoders.filter((name) => !encoders.has(name)).map((name) => `the ${name} encoder`),
    ...requiredFilters
      .filter((filter) => !filters.has(filter.name))
      .map((filter) => `the ${filter.name} filter (${filter.library})`),
  ];
  if (missing.length === 0) return;

  throw new Error(
    `The ffmpeg on PATH lacks ${new Intl.ListFormat("en", { type: "conjunction" }).format(missing)}, ` +
      "which the demo films need. Use an FFmpeg build with libwebp, libx264, and libass: on macOS, Homebrew's " +
      'ffmpeg-full, with "$(brew --prefix ffmpeg-full)/bin" ahead of other ffmpeg installs on PATH.',
  );
}
