import { join } from "node:path";
import { viewport, captionBandHeight } from "./constants";
import { createCaptions } from "./createCaptions";
import { readMediaInfo } from "./readMediaInfo";
import { runCommand } from "./runCommand";
import type { IRecordedClip } from "./types";

export async function exportClip(
  directoryPath: string,
  id: string,
  sourcePath: string,
  caption: string,
): Promise<IRecordedClip> {
  const source = await readMediaInfo(sourcePath);
  await Bun.write(join(directoryPath, `${id}.srt`), createCaptions([{ caption, duration: source.duration }]));
  const outputPath = join(directoryPath, `clips/${id}.mp4`);
  const contentFilter = [
    "fps=30",
    `scale=${viewport.width}:${viewport.height}:force_original_aspect_ratio=decrease`,
    `pad=${viewport.width}:${viewport.height}:(ow-iw)/2:(oh-ih)/2:color=0x171717`,
    "setsar=1",
  ].join(",");
  // force_style uses libass's internal alignment: vertical center (8) | horizontal center (2).
  const filter = [
    `[0:v]${contentFilter}[content]`,
    `color=c=0x171717:s=${viewport.width}x${captionBandHeight}:r=30,` +
      `subtitles=${id}.srt:force_style='PlayResX=${viewport.width},PlayResY=${captionBandHeight},` +
      "FontName=DejaVu Sans Mono,FontSize=37.5,Alignment=10,MarginL=32,MarginR=32,MarginV=0'[captions]",
    "[content][captions]vstack=inputs=2:shortest=1[out]",
  ].join(";");
  await runCommand(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourcePath,
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
  const output = await readMediaInfo(outputPath);
  return { id, path: outputPath, caption, duration: output.duration };
}
