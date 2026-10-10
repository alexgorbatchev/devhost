import { join, resolve } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { composeMusic } from "./composeMusic";
import { hashSpeechRequest } from "./hashSpeechRequest";
import { readGuideNarration } from "./readGuideNarration";
import { speakLine } from "./speakLine";
import type { IGuideAudioTimings, IPromoAudioApi, ISpokenLineRequest } from "./types";

// Generates the guide films' audio. A line whose request and file are unchanged keeps its take unless takes are retaken.
export async function generateGuideAudio(
  projectPath: string,
  part: string,
  guide: string,
  takes: string,
  api: IPromoAudioApi,
): Promise<IGuideAudioTimings> {
  if (!["all", "voice", "music"].includes(part)) throw new Error("Choose the audio to generate: all, voice, music");
  if (!["keep", "retake"].includes(takes)) throw new Error("Choose what happens to the recorded takes: keep, retake");
  const { voice, music, guides } = await readGuideNarration(projectPath);
  if (guide !== "all" && guides[guide] === undefined) throw new Error(`narration.json has no guide named ${guide}`);
  const timingsPath = join(projectPath, "assets/audio/timings.json");
  const timingsFile = Bun.file(timingsPath);
  const timings: IGuideAudioTimings = (await timingsFile.exists()) ? await timingsFile.json() : { guides: {} };
  const writeTimings = (): Promise<number> => Bun.write(timingsPath, JSON.stringify(timings, null, 2) + "\n");
  if (part !== "music") {
    for (const [slug, script] of Object.entries(guides)) {
      if (guide !== "all" && slug !== guide) continue;
      const lines = [{ clip: "intro", text: script.intro }, ...script.clips];
      const recorded = timings.guides[slug] ?? [];
      // Each line's take, in the narration's order. The take of a line the narration no longer has is dropped.
      const lineTakes = lines.map((line) => recorded.find((take) => take.id === line.clip));
      const recordTakes = (): Promise<number> => {
        timings.guides[slug] = lineTakes.flatMap((take) => take ?? []);
        return writeTimings();
      };
      for (const [index, line] of lines.entries()) {
        const path = `assets/audio/voice/${slug}/${line.clip}.mp3`;
        const request: ISpokenLineRequest = {
          voice,
          name: `${slug} ${line.clip}`,
          text: line.text,
          previousText: lines[index - 1]?.text,
          nextText: lines[index + 1]?.text,
        };
        const requestSha256 = hashSpeechRequest(request);
        const isTaken =
          takes === "keep" &&
          lineTakes[index]?.requestSha256 === requestSha256 &&
          (await Bun.file(join(projectPath, path)).exists());
        if (isTaken) continue;
        // The old take is forgotten before its file can be replaced, and the new one is recorded as soon as it
        // exists. A request that fails later then leaves every recorded take beside the file it describes.
        lineTakes[index] = undefined;
        await recordTakes();
        const spoken = await speakLine(api, request, join(projectPath, path));
        lineTakes[index] = { id: line.clip, path, requestSha256, ...spoken };
        await recordTakes();
      }
    }
  }
  if (part !== "voice") {
    const path = "assets/audio/music.mp3";
    timings.music = { path, duration: await composeMusic(api, music, join(projectPath, path)) };
    await writeTimings();
  }
  return timings;
}

if (import.meta.main) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (apiKey) {
    const client = new ElevenLabsClient({ apiKey });
    let generatedLines = 0;
    try {
      const timings = await generateGuideAudio(
        resolve(import.meta.dir, "guide"),
        process.env.DEVHOST_DEMO_AUDIO ?? "all",
        process.env.DEVHOST_DEMO_GUIDE ?? "all",
        process.env.DEVHOST_DEMO_TAKES ?? "keep",
        {
          // A retried generation is billed again, so a failed request stops the run instead.
          speak: (voiceId, request) => {
            generatedLines += 1;
            return client.textToSpeech.convertWithTimestamps(voiceId, request, { maxRetries: 0 });
          },
          compose: (request) => client.music.compose(request, { maxRetries: 0, timeoutInSeconds: 300 }),
        },
      );
      for (const [slug, lines] of Object.entries(timings.guides)) {
        for (const line of lines) console.log(`${slug} ${line.id}: ${line.duration.toFixed(2)}s`);
      }
      if (timings.music) console.log(`music: ${timings.music.duration.toFixed(2)}s`);
      console.log(`Lines generated: ${generatedLines}. Every other line kept its take.`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  } else {
    console.error("Set ELEVENLABS_API_KEY to generate the guide audio");
    process.exitCode = 1;
  }
}
