import { join, resolve } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { composeMusic } from "./composeMusic";
import { readGuideNarration } from "./readGuideNarration";
import { speakLine } from "./speakLine";
import type { IGuideAudioTimings, IPromoAudioApi, IPromoLineTiming } from "./types";

export async function generateGuideAudio(
  projectPath: string,
  part: string,
  guide: string,
  api: IPromoAudioApi,
): Promise<IGuideAudioTimings> {
  if (!["all", "voice", "music"].includes(part)) throw new Error("Choose the audio to generate: all, voice, music");
  const { voice, music, guides } = await readGuideNarration(projectPath);
  if (guide !== "all" && guides[guide] === undefined) throw new Error(`narration.json has no guide named ${guide}`);
  const timingsPath = join(projectPath, "assets/audio/timings.json");
  const timingsFile = Bun.file(timingsPath);
  const timings: IGuideAudioTimings = (await timingsFile.exists()) ? await timingsFile.json() : { guides: {} };
  if (part !== "music") {
    for (const [slug, script] of Object.entries(guides)) {
      if (guide !== "all" && slug !== guide) continue;
      const lines = [{ clip: "intro", text: script.intro }, ...script.clips];
      const spokenLines: IPromoLineTiming[] = [];
      for (const [index, line] of lines.entries()) {
        const path = `assets/audio/voice/${slug}/${line.clip}.mp3`;
        const spoken = await speakLine(
          api,
          {
            voice,
            name: `${slug} ${line.clip}`,
            text: line.text,
            previousText: lines[index - 1]?.text,
            nextText: lines[index + 1]?.text,
          },
          join(projectPath, path),
        );
        spokenLines.push({ id: line.clip, path, ...spoken });
      }
      timings.guides[slug] = spokenLines;
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
      const timings = await generateGuideAudio(
        resolve(import.meta.dir, "guide"),
        process.env.DEVHOST_DEMO_AUDIO ?? "all",
        process.env.DEVHOST_DEMO_GUIDE ?? "all",
        {
          // A retried generation is billed again, so a failed request stops the run instead.
          speak: (voiceId, request) => client.textToSpeech.convertWithTimestamps(voiceId, request, { maxRetries: 0 }),
          compose: (request) => client.music.compose(request, { maxRetries: 0, timeoutInSeconds: 300 }),
        },
      );
      for (const [slug, lines] of Object.entries(timings.guides)) {
        for (const line of lines) console.log(`${slug} ${line.id}: ${line.duration.toFixed(2)}s`);
      }
      if (timings.music) console.log(`music: ${timings.music.duration.toFixed(2)}s`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  } else {
    console.error("Set ELEVENLABS_API_KEY to generate the guide audio");
    process.exitCode = 1;
  }
}
