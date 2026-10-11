import { join, resolve } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { z } from "zod";
import { voiceSchema } from "./audioSchemas";
import { speakLine } from "./speakLine";
import type { IPromoAudioTimings, ISpeechApi } from "./types";

const narrationSchema = z.object({
  voice: voiceSchema,
  lines: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), text: z.string().min(1) })).min(1),
});

// Speaks every line of the promo's narration, its only sound.
export async function generatePromoAudio(projectPath: string, api: ISpeechApi): Promise<IPromoAudioTimings> {
  const parsed = narrationSchema.safeParse(await Bun.file(join(projectPath, "narration.json")).json());
  if (!parsed.success) throw new Error(`narration.json is invalid: ${z.prettifyError(parsed.error)}`);
  const { voice, lines } = parsed.data;
  const timings: IPromoAudioTimings = { lines: [] };
  for (const [index, line] of lines.entries()) {
    const path = `assets/audio/voice/${line.id}.mp3`;
    const spoken = await speakLine(
      api,
      {
        voice,
        name: line.id,
        text: line.text,
        previousText: lines[index - 1]?.text,
        nextText: lines[index + 1]?.text,
      },
      join(projectPath, path),
    );
    timings.lines.push({ id: line.id, path, ...spoken });
  }
  await Bun.write(join(projectPath, "assets/audio/timings.json"), JSON.stringify(timings, null, 2) + "\n");
  return timings;
}

if (import.meta.main) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (apiKey) {
    const client = new ElevenLabsClient({ apiKey });
    try {
      const timings = await generatePromoAudio(resolve(import.meta.dir, "promo"), {
        // A retried generation is billed again, so a failed request stops the run instead.
        speak: (voiceId, request) => client.textToSpeech.convertWithTimestamps(voiceId, request, { maxRetries: 0 }),
      });
      for (const line of timings.lines) console.log(`${line.id}: ${line.duration.toFixed(2)}s`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  } else {
    console.error("Set ELEVENLABS_API_KEY to generate the promo audio");
    process.exitCode = 1;
  }
}
