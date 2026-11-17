import { join } from "node:path";
import { createDemoVideoBlock } from "./createDemoVideoBlock";
import { exportDemoMedia } from "./exportDemoMedia";
import { runCommand } from "./runCommand";

// The end card's last frame, once its tagline has finished typing.
const posterLead = 0.1;

// Writes the promo's docs media, the README's preview of it, and the block the docs landing page shows it with.
export async function publishPromoDemo(repositoryPath: string, recordingPath: string): Promise<void> {
  // The poster is the end card, which names devhost and its address; the first frames show a bare address.
  const media = await exportDemoMedia(repositoryPath, "promo", recordingPath, ({ duration }) =>
    Math.max(0, duration - posterLead),
  );
  // GitHub removes a video from a README but shows an animated image. The preview is the whole film, silent and
  // looping, at half its width and a third of its frame rate: its text stays readable at under 3 MB.
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    join(recordingPath, "devhost-demo.mp4"),
    "-vf",
    "fps=10,scale=960:-2:flags=lanczos",
    "-an",
    "-c:v",
    "libwebp_anim",
    "-lossless",
    "0",
    "-quality",
    "70",
    "-compression_level",
    "6",
    "-loop",
    "0",
    join(repositoryPath, "packages/docs/public/demos/promo-preview.webp"),
  ]);
  await Bun.write(
    join(repositoryPath, "packages/docs/src/promoDemo.html"),
    `${createDemoVideoBlock({ marker: "promo-demo", name: "promo", label: "devhost promo", media })}\n`,
  );
}
