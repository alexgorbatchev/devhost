import { formatSrtTimestamp } from "./formatSrtTimestamp";
import type { IPromoAudioTimings, IPromoNarrationLine } from "./types";

export async function createPromoCaptions(
  compositionHtml: string,
  lines: readonly IPromoNarrationLine[],
  timings: IPromoAudioTimings,
): Promise<string> {
  const starts = new Map<string, number>();
  const clipSeconds = new Map<string, number>();
  await new HTMLRewriter()
    .on("audio[data-narration]", {
      element: (element): void => {
        const lineId = element.getAttribute("data-narration") ?? "";
        starts.set(lineId, Number(element.getAttribute("data-start")));
        const duration = element.getAttribute("data-duration");
        if (duration !== null) clipSeconds.set(lineId, Number(duration));
      },
    })
    .transform(new Response(compositionHtml))
    .text();
  const cues = lines.map((line) => {
    const start = starts.get(line.id);
    const fileSeconds = timings.lines.find((timing) => timing.id === line.id)?.duration;
    if (start === undefined || !Number.isFinite(start)) {
      throw new Error(`The composition has no audio clip for narration line ${line.id}`);
    }
    if (fileSeconds === undefined) throw new Error(`No generated audio timing for narration line ${line.id}`);
    // The composition may cut a voice file's trailing silence; the caption ends with what is heard.
    return { start, end: start + Math.min(fileSeconds, clipSeconds.get(line.id) ?? fileSeconds), text: line.text };
  });
  return cues
    .map((cue, index) => {
      const end = Math.min(cue.end, cues[index + 1]?.start ?? cue.end);
      return `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(end)}\n${cue.text}\n`;
    })
    .join("\n");
}
