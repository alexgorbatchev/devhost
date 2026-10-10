import { createSpeechRequest } from "./createSpeechRequest";
import type { ISpokenLineRequest } from "./types";

// Names the take a request asks for: the same voice, settings, line, and neighbouring lines give the same SHA-256.
export function hashSpeechRequest(request: ISpokenLineRequest): string {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify([request.voice.id, createSpeechRequest(request)]))
    .digest("hex");
}
