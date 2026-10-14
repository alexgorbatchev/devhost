import { runCommand } from "../../runCommand";

// Reads a poster's average color as red, green and blue from 0 to 255.
export async function readPosterColor(posterPath: string): Promise<number[]> {
  const pixelPath = `${posterPath}.rgb`;
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    posterPath,
    "-vf",
    "scale=1:1:flags=area",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    pixelPath,
  ]);
  return [...(await Bun.file(pixelPath).bytes())];
}
