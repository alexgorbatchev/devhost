import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { IFoundGuideRecording, IGuideRecord } from "./types";

const recordSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  address: z.string().min(1),
  clips: z
    .array(
      z.object({
        clip: z.string().min(1),
        footage: z.object({ sourceId: z.string().min(1), from: z.number().optional(), to: z.number().optional() }),
        poster: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

// Finds the most recently captured run of a guide, so its film can be rendered again without recording.
export async function findGuideRecording(parentPath: string, slug: string): Promise<IFoundGuideRecording> {
  let latest: IFoundGuideRecording | undefined;
  let latestCaptured = Number.NEGATIVE_INFINITY;
  for (const name of await readdir(parentPath).catch((): string[] => [])) {
    if (!name.startsWith("recording-")) continue;
    const directoryPath = join(parentPath, name);
    const parsed = recordSchema.safeParse(
      await Bun.file(join(directoryPath, "guide.json"))
        .json()
        .catch((): undefined => undefined),
    );
    if (!parsed.success || parsed.data.slug !== slug) continue;
    const record: IGuideRecord = parsed.data;
    // A later render rewrites the run's files, so its age is that of the footage itself.
    const footage = await readdir(join(directoryPath, "raw")).catch((): string[] => []);
    const modified = await Promise.all(
      footage.map(async (file) => (await stat(join(directoryPath, "raw", file))).mtimeMs),
    );
    const captured = Math.max(...modified);
    if (latest === undefined || captured > latestCaptured) {
      latest = { directoryPath, record };
      latestCaptured = captured;
    }
  }
  if (latest === undefined) {
    throw new Error(`No recording of the ${slug} guide; run \`just demo guides ${slug}\` first`);
  }
  return latest;
}
