import { join } from "node:path";
import { z } from "zod";
import { voiceSchema } from "./audioSchemas";
import type { IGuideNarration } from "./types";

const narrationSchema = z.object({
  voice: voiceSchema,
  guides: z.record(
    z.string().regex(/^[a-z][a-z0-9-]*$/),
    z.object({
      // The guide's promise, spoken over the title card.
      intro: z.string().min(1),
      // One line per clip, in the order the clips play and named after them.
      clips: z.array(z.object({ clip: z.string().regex(/^[a-z0-9-]+$/), text: z.string().min(1) })).min(1),
    }),
  ),
});

export async function readGuideNarration(projectPath: string): Promise<IGuideNarration> {
  const parsed = narrationSchema.safeParse(await Bun.file(join(projectPath, "narration.json")).json());
  if (!parsed.success) throw new Error(`narration.json is invalid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
