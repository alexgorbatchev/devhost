import { join } from "node:path";
import { createDemoVideoBlock } from "./createDemoVideoBlock";
import { exportDemoMedia } from "./exportDemoMedia";

// The end card's last frame, once its tagline has finished typing.
const posterLead = 0.1;

// Writes the promo's docs media and the block the docs landing page shows it with.
export async function publishPromoDemo(repositoryPath: string, recordingPath: string): Promise<void> {
  // The poster is the end card, which names devhost and its address; the first frames show a bare address.
  const media = await exportDemoMedia(repositoryPath, "promo", recordingPath, ({ duration }) =>
    Math.max(0, duration - posterLead),
  );
  await Bun.write(
    join(repositoryPath, "packages/docs/src/promoDemo.html"),
    `${createDemoVideoBlock({ marker: "promo-demo", name: "promo", label: "devhost promo", media })}\n`,
  );
}
