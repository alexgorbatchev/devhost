import { runCommand } from "./runCommand";

// Measures the average brightness of every frame of a video, from 0 to 255.
export async function readFrameBrightness(path: string, signal: AbortSignal): Promise<number[]> {
  const output = await runCommand(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
      "-f",
      "null",
      "-",
    ],
    { signal },
  );
  const brightness: number[] = [];
  for (const line of output.split("\n")) {
    const value = /^lavfi\.signalstats\.YAVG=(.+)$/.exec(line.trim())?.[1];
    if (value !== undefined) brightness.push(Number(value));
  }
  return brightness;
}
