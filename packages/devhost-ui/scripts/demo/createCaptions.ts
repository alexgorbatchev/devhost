import { formatSrtTimestamp } from "./formatSrtTimestamp";
import type { ICaptionClip } from "./types";

export function createCaptions(clips: readonly ICaptionClip[]): string {
  let elapsed = 0;
  return clips
    .map((clip, index) => {
      if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
        throw new Error("Clip duration must be finite and positive");
      }
      const start = elapsed;
      elapsed += clip.duration;
      return `${index + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(elapsed)}\n${clip.caption}\n`;
    })
    .join("\n");
}
