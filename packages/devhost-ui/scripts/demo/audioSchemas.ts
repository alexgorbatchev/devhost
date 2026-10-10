import { ElevenLabs } from "@elevenlabs/elevenlabs-js";
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

export const musicSchema = z.object({
  model: z.enum(ElevenLabs.MusicModelId),
  // Timed sections let the music turn where the picture does.
  sections: z
    .array(
      z.object({
        name: z.string().min(1),
        seconds: z.number().min(3).max(120),
        styles: z.array(z.string().min(1)).min(1),
        avoid: z.array(z.string().min(1)),
      }),
    )
    .min(1),
});
