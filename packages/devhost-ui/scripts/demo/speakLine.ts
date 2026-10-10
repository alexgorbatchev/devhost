import { createPromoWords } from "./createPromoWords";
import { readAudioDuration } from "./readAudioDuration";
import type { IPromoAudioApi, ISpokenLine, ISpokenLineRequest } from "./types";

// Speaks one narration line into a file and measures it.
export async function speakLine(
  api: IPromoAudioApi,
  request: ISpokenLineRequest,
  outputPath: string,
): Promise<ISpokenLine> {
  const { voice } = request;
  const response = await api.speak(voice.id, {
    text: request.text,
    modelId: voice.model,
    outputFormat: "mp3_44100_128",
    voiceSettings: {
      stability: voice.stability,
      similarityBoost: voice.similarityBoost,
      style: voice.style,
      speed: voice.speed,
    },
    // The neighbouring lines keep the delivery continuous across separately generated files.
    previousText: request.previousText,
    nextText: request.nextText,
  });
  if (!response.alignment) throw new Error(`ElevenLabs returned no word timings for ${request.name}`);
  await Bun.write(outputPath, Buffer.from(response.audioBase64, "base64"));
  return { duration: await readAudioDuration(outputPath), words: createPromoWords(response.alignment) };
}
