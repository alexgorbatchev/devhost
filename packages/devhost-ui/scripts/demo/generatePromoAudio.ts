import { join, resolve } from "node:path";
import { ElevenLabs, ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { z } from "zod";
import { createPromoWords } from "./createPromoWords";
import { readAudioDuration } from "./readAudioDuration";
import type { IPromoAudioApi, IPromoAudioTimings } from "./types";

const narrationSchema = z.object({
  voice: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    model: z.string().min(1),
    stability: z.number(),
    similarityBoost: z.number(),
    style: z.number(),
    speed: z.number().optional(),
  }),
  lines: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), text: z.string().min(1) })).min(1),
  music: z.object({
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
  }),
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
      const response = await api.speak(voice.id, {
        text: line.text,
        modelId: voice.model,
        outputFormat: "mp3_44100_128",
        voiceSettings: {
          stability: voice.stability,
          similarityBoost: voice.similarityBoost,
          style: voice.style,
          speed: voice.speed,
        },
        // The neighbouring lines keep the delivery continuous across separately generated files.
        previousText: lines[index - 1]?.text,
        nextText: lines[index + 1]?.text,
      });
      if (!response.alignment) throw new Error(`ElevenLabs returned no word timings for ${line.id}`);
      const path = `assets/audio/voice/${line.id}.mp3`;
      await Bun.write(join(projectPath, path), Buffer.from(response.audioBase64, "base64"));
      timings.lines.push({
        id: line.id,
        path,
        duration: await readAudioDuration(join(projectPath, path)),
        words: createPromoWords(response.alignment),
      });
    }
  }
  if (part !== "voice") {
    const path = "assets/audio/music.mp3";
    const stream = await api.compose({
      modelId: music.model,
      compositionPlan: {
        chunks: music.sections.map((section) => ({
          text: `[${section.name}]`,
          durationMs: Math.round(section.seconds * 1_000),
          positiveStyles: section.styles,
          negativeStyles: section.avoid,
        })),
      },
    });
    // Bun 1.4 never finishes writing a Response that wraps the SDK's stream, so the audio is read to bytes first.
    await Bun.write(join(projectPath, path), await new Response(stream).bytes());
    timings.music = { path, duration: await readAudioDuration(join(projectPath, path)) };
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
