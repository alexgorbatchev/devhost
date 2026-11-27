import { createPromoWords } from "./createPromoWords";
import { createSpeechRequest } from "./createSpeechRequest";
import { readAudioDuration } from "./readAudioDuration";
import type { ISpeechApi, ISpokenLine, ISpokenLineRequest } from "./types";

// Speaks one narration line into a file and measures it.
export async function speakLine(
  api: ISpeechApi,
  request: ISpokenLineRequest,
  outputPath: string,
): Promise<ISpokenLine> {
  const { voice } = request;
  // The voice ID alone does not say which voice failed; narration.json names it beside the ID.
  const speaker = `voice ${voice.name} (${voice.id})`;
  const response = await api.speak(voice.id, createSpeechRequest(request)).catch((error: unknown): never => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`ElevenLabs could not speak ${request.name} with ${speaker}: ${reason}`, { cause: error });
  });
  if (!response.alignment) throw new Error(`ElevenLabs returned no word timings for ${request.name} with ${speaker}`);
  await Bun.write(outputPath, Buffer.from(response.audioBase64, "base64"));
  return { duration: await readAudioDuration(outputPath), words: createPromoWords(response.alignment) };
}
