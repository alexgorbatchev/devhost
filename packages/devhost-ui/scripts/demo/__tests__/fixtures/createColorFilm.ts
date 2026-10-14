import { runCommand } from "../../runCommand";

// Renders a master as a renderer leaves it, with each part of the film a solid color of its own, in order and for its
// seconds, so a poster shows which part it was taken from.
export async function createColorFilm(path: string, parts: Map<string, number>): Promise<void> {
  const duration = [...parts.values()].reduce((total, seconds) => total + seconds, 0);
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    ...[...parts].flatMap(([color, seconds]) => [
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=1920x1080:r=30:d=${seconds}`,
    ]),
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${duration}`,
    "-filter_complex",
    `${[...parts.keys()].map((_, index) => `[${index}:v]`).join("")}concat=n=${parts.size}:v=1:a=0[video]`,
    "-map",
    "[video]",
    "-map",
    `${parts.size}:a`,
    // Lossless, in a pixel format browsers do not play.
    "-c:v",
    "libx264",
    "-qp",
    "0",
    "-pix_fmt",
    "yuv444p",
    "-shortest",
    path,
  ]);
}
