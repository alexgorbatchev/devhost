import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import type { ISpokenLineRequest } from "./types";

// What ElevenLabs is asked for one narration line.
export function createSpeechRequest(request: ISpokenLineRequest): ElevenLabs.BodyTextToSpeechFullWithTimestamps {
  const { voice } = request;
  return {
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
  };
}
