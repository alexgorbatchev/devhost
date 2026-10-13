import { join } from "node:path";
import { z } from "zod";
import { createDemoVideoBlock } from "./createDemoVideoBlock";
import { exportDemoMedia } from "./exportDemoMedia";

const narrationSchema = z.object({ lines: z.array(z.object({ text: z.string().min(1) })) });

// Writes the promo's docs media and the block the docs landing page shows it with. The transcript is the narration.
export async function publishPromoDemo(
  repositoryPath: string,
  recordingPath: string,
  projectPath: string,
): Promise<void> {
  const narration = narrationSchema.parse(await Bun.file(join(projectPath, "narration.json")).json());
  if (narration.lines.length === 0) throw new Error("The promo's narration has no lines");
  // The poster is the end card, which names devhost; the first frames show a bare address.
  const media = await exportDemoMedia(repositoryPath, "promo", recordingPath, ({ duration }) =>
    Math.max(0, duration - 1.5),
  );
  await Bun.write(
    join(repositoryPath, "packages/docs/src/promoDemo.html"),
    `${createDemoVideoBlock({
      marker: "promo-demo",
      name: "promo",
      label: "devhost promo",
      media,
      transcript: narration.lines.map((line) => line.text),
    })}\n`,
  );
}
