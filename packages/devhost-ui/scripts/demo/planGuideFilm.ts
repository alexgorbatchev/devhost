import assert from "node:assert/strict";
import { guideIntroSeconds, guideOutroSeconds, promoMaximumSeconds } from "./constants";
import { planFootageSpeed } from "./planFootageSpeed";
import type { IGuideBeat, IGuideClipInput, IGuideFilmPlan, IGuideIntroInput } from "./types";

// The intro line starts once the title card has landed; a later line starts just after its clip does.
const introLineStart = 0.35;
const lineDelay = 0.15;
// A card or clip stays on screen for a breath after its line ends.
const lineTail = 0.3;
// A poster at the end of a clip is its own last frame, before the cut to the next one.
const posterLead = 0.1;

function round(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
}

// The frame a clip marked, where it plays in the film; without a mark, the end of the first step, past the title card
// every guide opens with.
function planPoster(clips: readonly IGuideClipInput[], beats: readonly IGuideBeat[]): number {
  const marked = clips.findIndex((clip) => clip.poster !== undefined);
  const index = marked === -1 ? 0 : marked;
  const clip = clips[index];
  const beat = beats[index];
  assert(clip && beat);
  const lastFrame = beat.start + beat.duration - posterLead;
  if (clip.poster === undefined) return round(lastFrame);
  const speed = planFootageSpeed(clip.sourceSeconds, beat.duration);
  const offset = Math.max(0, clip.poster - (clip.footage.from ?? 0)) / speed;
  return round(Math.min(lastFrame, beat.start + offset));
}

export function planGuideFilm(intro: IGuideIntroInput, clips: readonly IGuideClipInput[]): IGuideFilmPlan {
  if (clips.length === 0) throw new Error("A guide film needs at least one clip");
  // The title card stays until the intro line has been spoken.
  const introSeconds = round(Math.max(guideIntroSeconds, introLineStart + intro.narrationSeconds + lineTail));
  // The shortest slot that still lets each clip's line finish.
  const minimums = clips.map((clip) => lineDelay + clip.narrationSeconds + lineTail);
  const budget = promoMaximumSeconds - introSeconds - guideOutroSeconds;
  const needed = minimums.reduce((total, seconds) => total + seconds, 0);
  if (needed > budget) {
    throw new Error(
      `The narration needs ${round(needed + introSeconds + guideOutroSeconds)}s, ` +
        `which is over the ${promoMaximumSeconds}s a guide film may last`,
    );
  }
  // A clip plays at its recorded speed and holds its last frame when its line runs longer.
  const durations = clips.map((clip, index) => Math.max(clip.sourceSeconds, minimums[index] ?? 0));
  // Over the limit, the clips that can spare time play faster in proportion; none drops below what its line needs.
  const fixed = new Set<number>();
  for (;;) {
    const fixedSeconds = [...fixed].reduce((total, index) => total + (durations[index] ?? 0), 0);
    const free = durations.map((_, index) => index).filter((index) => !fixed.has(index));
    const freeSeconds = free.reduce((total, index) => total + (durations[index] ?? 0), 0);
    if (fixedSeconds + freeSeconds <= budget || free.length === 0) break;
    const factor = (budget - fixedSeconds) / freeSeconds;
    const clamped = free.filter((index) => (durations[index] ?? 0) * factor < (minimums[index] ?? 0));
    if (clamped.length === 0) {
      for (const index of free) durations[index] = (durations[index] ?? 0) * factor;
      break;
    }
    for (const index of clamped) {
      durations[index] = minimums[index] ?? 0;
      fixed.add(index);
    }
  }
  const beats: IGuideBeat[] = [];
  // A clip runs from one rounded boundary to the next, so the rounding of each length never adds up to a longer film.
  let end = introSeconds;
  for (const [index, clip] of clips.entries()) {
    const start = round(end);
    end += durations[index] ?? 0;
    beats.push({
      clip: clip.clip,
      text: clip.text,
      footage: clip.footage,
      start,
      duration: round(round(end) - start),
      narrationStart: round(start + lineDelay),
      narrationSeconds: clip.narrationSeconds,
    });
  }
  return {
    duration: round(round(end) + guideOutroSeconds),
    poster: planPoster(clips, beats),
    introSeconds,
    outroSeconds: guideOutroSeconds,
    intro: { ...intro, narrationStart: introLineStart },
    beats,
  };
}
