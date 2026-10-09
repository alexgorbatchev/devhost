import { runCommand } from "./runCommand";

export async function readAudioDuration(path: string): Promise<number> {
  const output = await runCommand([
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    path,
  ]);
  const duration = Number(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Audio has no valid duration: ${path}`);
  return duration;
}
