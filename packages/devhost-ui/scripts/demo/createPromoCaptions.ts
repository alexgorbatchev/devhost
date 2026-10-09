import { formatSrtTimestamp } from "./formatSrtTimestamp";
import type { IPromoAudioTimings, IPromoNarrationLine } from "./types";

export async function createPromoCaptions(
  compositionHtml: string,
  lines: readonly IPromoNarrationLine[],
  timings: IPromoAudioTimings,
): Promise<string> {
  const starts = new Map<string, number>();
  await new HTMLRewriter()
    .on("audio[data-narration]", {
      element: (element): void => {
        starts.set(element.getAttribute("data-narration") ?? "", Number(element.getAttribute("data-start")));
      },
    })
    .transform(new Response(compositionHtml))
    .text();
  const cues = lines.map((line) => {
    const start = starts.get(line.id);
    const duration = timings.lines.find((timing) => timing.id === line.id)?.duration;
    if (start === undefined || !Number.isFinite(start)) {
      throw new Error(`The composition has no audio clip for narration line ${line.id}`);
    }
    if (duration === undefined) throw new Error(`No generated audio timing for narration line ${line.id}`);
    return { start, end: start + duration, text: line.text };
  });
  return cues
    .map((cue, index) => {
      // A voice file ends in silence, so its caption yields to the next line as soon as that one starts.
      const end = Math.min(cue.end, cues[index + 1]?.start ?? cue.end);
      return `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(end)}\n${cue.text}\n`;
    })
    .join("\n");
}
