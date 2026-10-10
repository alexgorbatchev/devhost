import { readAudioDuration } from "./readAudioDuration";
import type { IMusicRequest, IPromoAudioApi } from "./types";

// Composes a music track from its timed sections into a file and returns its length in seconds.
export async function composeMusic(api: IPromoAudioApi, music: IMusicRequest, outputPath: string): Promise<number> {
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
  await Bun.write(outputPath, await new Response(stream).bytes());
  return readAudioDuration(outputPath);
}
