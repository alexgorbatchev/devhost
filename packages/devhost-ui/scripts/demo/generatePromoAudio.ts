import { join, resolve } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { z } from "zod";
import { musicSchema, voiceSchema } from "./audioSchemas";
import { composeMusic } from "./composeMusic";
import { speakLine } from "./speakLine";
import type { IPromoAudioApi, IPromoAudioTimings } from "./types";

const narrationSchema = z.object({
  voice: voiceSchema,
  lines: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), text: z.string().min(1) })).min(1),
  music: musicSchema,
});

export async function generatePromoAudio(
  projectPath: string,
  part: string,
  api: IPromoAudioApi,
): Promise<IPromoAudioTimings> {
  if (!["all", "voice", "music"].includes(part)) throw new Error("Choose the audio to generate: all, voice, music");
  const parsed = narrationSchema.safeParse(await Bun.file(join(projectPath, "narration.json")).json());
  if (!parsed.success) throw new Error(`narration.json is invalid: ${z.prettifyError(parsed.error)}`);
  const { voice, lines, music } = parsed.data;
  const timingsPath = join(projectPath, "assets/audio/timings.json");
  const timingsFile = Bun.file(timingsPath);
  const timings: IPromoAudioTimings = (await timingsFile.exists()) ? await timingsFile.json() : { lines: [] };
  if (part !== "music") {
    timings.lines = [];
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
  }
  if (part !== "voice") {
    const path = "assets/audio/music.mp3";
    timings.music = { path, duration: await composeMusic(api, music, join(projectPath, path)) };
  }
  await Bun.write(timingsPath, JSON.stringify(timings, null, 2) + "\n");
  return timings;
}

if (import.meta.main) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (apiKey) {
    const client = new ElevenLabsClient({ apiKey });
    try {
      const timings = await generatePromoAudio(
        resolve(import.meta.dir, "promo"),
        process.env.DEVHOST_DEMO_AUDIO ?? "all",
        {
          // A retried generation is billed again, so a failed request stops the run instead.
          speak: (voiceId, request) => client.textToSpeech.convertWithTimestamps(voiceId, request, { maxRetries: 0 }),
          compose: (request) => client.music.compose(request, { maxRetries: 0, timeoutInSeconds: 300 }),
        },
      );
      for (const line of timings.lines) console.log(`${line.id}: ${line.duration.toFixed(2)}s`);
      if (timings.music) console.log(`music: ${timings.music.duration.toFixed(2)}s`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  } else {
    console.error("Set ELEVENLABS_API_KEY to generate the promo audio");
    process.exitCode = 1;
  }
}
