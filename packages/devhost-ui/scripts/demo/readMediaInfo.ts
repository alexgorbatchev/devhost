import { runCommand } from "./runCommand";
import type { IMediaInfo } from "./types";

export async function readMediaInfo(path: string, signal?: AbortSignal): Promise<IMediaInfo> {
  const output = await runCommand(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "format=duration:stream=width,height",
      "-of",
      "json",
      path,
    ],
    { signal },
  );
  const value: unknown = JSON.parse(output);
  if (typeof value !== "object" || value === null) throw new Error("Invalid ffprobe output");
  const format: unknown = Reflect.get(value, "format");
  const streams: unknown = Reflect.get(value, "streams");
  if (typeof format !== "object" || format === null || !Array.isArray(streams))
    throw new Error("Missing video metadata");
  const stream: unknown = streams[0];
  if (typeof stream !== "object" || stream === null) throw new Error("Missing video stream");
  const duration = Number(Reflect.get(format, "duration"));
  const width: unknown = Reflect.get(stream, "width");
  const height: unknown = Reflect.get(stream, "height");
  if (!Number.isFinite(duration) || duration <= 0 || typeof width !== "number" || typeof height !== "number") {
    throw new Error("Video has no valid duration or dimensions");
  }
  return { duration, width, height };
}
