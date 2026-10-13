import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readMediaInfo } from "./readMediaInfo";
import { runCommand } from "./runCommand";
import type { IMediaInfo, PosterSeconds } from "./types";

// Writes a film's poster, captions and web encode into the docs site's public directory under one name.
export async function exportDemoMedia(
  repositoryPath: string,
  name: string,
  recordingPath: string,
  posterSeconds: PosterSeconds,
): Promise<IMediaInfo> {
  const videoPath = join(recordingPath, "devhost-demo.mp4");
  const media = await readMediaInfo(videoPath);
  const publicPath = join(repositoryPath, "packages/docs/public/demos");
  await mkdir(publicPath, { recursive: true });
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-ss",
    String(posterSeconds(media)),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    join(publicPath, `${name}.webp`),
  ]);
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    join(recordingPath, "devhost-demo.srt"),
    join(publicPath, `${name}.vtt`),
  ]);
  // The render is a master of several megabytes; the page gets an encode a quarter of that size, with the same
  // picture and sound, that starts playing before it has downloaded.
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    videoPath,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "27",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    join(publicPath, `${name}.mp4`),
  ]);
  return media;
}
