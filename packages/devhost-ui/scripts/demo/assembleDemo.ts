import assert from "node:assert/strict";
import { join } from "node:path";
import { createCaptions } from "./createCaptions";
import { readMediaInfo } from "./readMediaInfo";
import { runCommand } from "./runCommand";
import type { RecordedClip } from "./types";

export async function assembleDemo(directoryPath: string, clips: readonly RecordedClip[]): Promise<string> {
  assert(clips.length > 0, "No demo clips were recorded");
  const outputPath = join(directoryPath, "devhost-demo.mp4");
  const filter =
    clips.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS[v${index}]`).join(";") +
    ";" +
    clips.map((_, index) => `[v${index}]`).join("") +
    `concat=n=${clips.length}:v=1:a=0[out]`;
  await runCommand(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...clips.flatMap((clip) => ["-i", clip.path]),
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { cwd: directoryPath },
  );
  await Bun.write(join(directoryPath, "devhost-demo.srt"), createCaptions(clips));
  const metadata = await readMediaInfo(outputPath);
  const expectedDuration = clips.reduce((total, clip) => total + clip.duration, 0);
  assert(Math.abs(metadata.duration - expectedDuration) < 0.2, "The assembled demo has an unexpected duration");
  await runCommand([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "2",
    "-i",
    outputPath,
    "-frames:v",
    "1",
    join(directoryPath, "poster.png"),
  ]);
  await Bun.write(join(directoryPath, "clips.json"), JSON.stringify({ ...metadata, clips }, null, 2) + "\n");
  return outputPath;
}
