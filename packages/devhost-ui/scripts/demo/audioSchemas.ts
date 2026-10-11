import { z } from "zod";

export const voiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
  stability: z.number(),
  similarityBoost: z.number(),
  style: z.number(),
  speed: z.number().optional(),
});
