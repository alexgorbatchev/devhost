import { createPromoWords } from "./createPromoWords";
import { createSpeechRequest } from "./createSpeechRequest";
import { readAudioDuration } from "./readAudioDuration";
import type { IPromoAudioApi, ISpokenLine, ISpokenLineRequest } from "./types";

// Speaks one narration line into a file and measures it.
export async function speakLine(
  api: IPromoAudioApi,
  request: ISpokenLineRequest,
  outputPath: string,
): Promise<ISpokenLine> {
  const response = await api.speak(request.voice.id, createSpeechRequest(request));
  if (!response.alignment) throw new Error(`ElevenLabs returned no word timings for ${request.name}`);
  await Bun.write(outputPath, Buffer.from(response.audioBase64, "base64"));
  return { duration: await readAudioDuration(outputPath), words: createPromoWords(response.alignment) };
}
