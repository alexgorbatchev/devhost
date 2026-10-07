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
      return `${index + 1}\n${formatTimestamp(start)} --> ${formatTimestamp(elapsed)}\n${clip.caption}\n`;
    })
    .join("\n");
}

function formatTimestamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1_000);
  const hours = Math.floor(milliseconds / 3_600_000)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((milliseconds / 60_000) % 60)
    .toString()
    .padStart(2, "0");
  const wholeSeconds = Math.floor((milliseconds / 1_000) % 60)
    .toString()
    .padStart(2, "0");
  const fraction = (milliseconds % 1_000).toString().padStart(3, "0");
  return `${hours}:${minutes}:${wholeSeconds},${fraction}`;
}
