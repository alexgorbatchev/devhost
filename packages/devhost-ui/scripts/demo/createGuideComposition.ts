import type { IGuideCueLine, IGuideFilm, IGuideFilmPlan, IVolumePoint } from "./types";

function round(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
}

// The bed opens at 0.3, drops under each line, comes back in a pause between lines, and fades out with the film.
function createMusicLane(plan: IGuideFilmPlan, spoken: readonly IGuideCueLine[]): IVolumePoint[] {
  const points: IVolumePoint[] = [{ t: 0, v: 0.3 }];
  const add = (t: number, v: number): void => {
    const last = points.at(-1);
    points.push({ t: round(Math.min(plan.duration, Math.max(t, (last?.t ?? 0) + 0.01))), v });
  };
  for (const [index, line] of spoken.entries()) {
    const spokenUntil = line.narrationStart + line.narrationSeconds;
    const next = spoken[index + 1];
    add(line.narrationStart - 0.1, points.at(-1)?.v ?? 0.3);
    add(line.narrationStart + 0.2, 0.1);
    add(spokenUntil + 0.1, 0.1);
    // A pause of more than a second and a half is long enough to hear the bed again.
    if (next === undefined || next.narrationStart - spokenUntil > 1.5) add(spokenUntil + 0.7, 0.24);
  }
  const outroStart = plan.duration - plan.outroSeconds;
  add(outroStart, 0.24);
  add(outroStart + 0.3, 0.34);
  add(plan.duration - 0.8, 0.34);
  points.push({ t: plan.duration, v: 0 });
  return points;
}

// Fills the guide film's template with one guide: its title, clips, captions, narration and every duration.
export async function createGuideComposition(template: string, film: IGuideFilm): Promise<string> {
  const { plan, title } = film;
  // The intro's caption stays for the title card; a clip's caption stays until its clip ends.
  const spoken: IGuideCueLine[] = [
    { id: "intro", ...plan.intro, visibleUntil: plan.introSeconds },
    ...plan.beats.map((beat) => ({
      id: beat.clip,
      text: beat.text,
      narrationStart: beat.narrationStart,
      narrationSeconds: beat.narrationSeconds,
      visibleUntil: beat.start + beat.duration,
    })),
  ];
  const cues: string[] = [];
  const narration: string[] = [];
  const cueData: object[] = [];
  for (const line of spoken) {
    if (!/^[a-z0-9-]+$/.test(line.id)) {
      throw new Error(`A clip name must be lowercase letters, digits and hyphens: ${line.id}`);
    }
    const audio = film.lines.find((candidate) => candidate.id === line.id);
    if (audio === undefined) throw new Error(`No narration audio for ${line.id}: generate the guide audio`);
    const words = line.text.split(/\s+/).filter((word) => word !== "");
    if (words.length !== audio.words.length) {
      throw new Error(
        `The audio of ${line.id} times ${audio.words.length} words, but its line has ${words.length}: ` +
          "generate the guide audio again",
      );
    }
    const cueStart = round(Math.max(0, line.narrationStart - 0.05));
    const spans = words.map(
      (word, index) => `<span id="cue-${line.id}-w${index}" class="guide-word">${Bun.escapeHTML(word)}</span>`,
    );
    cues.push(
      `<div id="cue-${line.id}" class="guide-cue">\n<p class="guide-cue-card">\n${spans.join("\n")}\n</p>\n</div>`,
    );
    narration.push(
      `<audio id="voice-${line.id}" data-narration="${line.id}" data-audio-group="voiceover" ` +
        `src="${Bun.escapeHTML(audio.path)}" data-start="${line.narrationStart}" ` +
        `data-duration="${line.narrationSeconds}" data-track-index="10" data-volume="1"></audio>`,
    );
    cueData.push({
      cue: `cue-${line.id}`,
      cueStart,
      cueEnd: round(line.visibleUntil),
      words: audio.words.map((word) => round(line.narrationStart + word.start)),
    });
  }
  const clips = plan.beats.map((beat) => {
    const window = [
      `data-footage="${beat.footage.sourceId}"`,
      beat.footage.from === undefined ? "" : `data-footage-from="${beat.footage.from}"`,
      beat.footage.to === undefined ? "" : `data-footage-to="${beat.footage.to}"`,
    ];
    return (
      `<video id="clip-${beat.clip}" class="clip" src="assets/footage/clip-${beat.clip}.mp4" ` +
      `${window.filter((attribute) => attribute !== "").join(" ")} data-start="${beat.start}" ` +
      `data-duration="${beat.duration}" data-track-index="2" muted playsinline></video>`
    );
  });
  const data = JSON.stringify({
    duration: plan.duration,
    introSeconds: plan.introSeconds,
    outroSeconds: plan.outroSeconds,
    // Every clip after the first starts on a cut.
    cuts: plan.beats.slice(1).map((beat) => beat.start),
    cues: cueData,
  });
  const lane = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: createMusicLane(plan, spoken) }] });
  return new HTMLRewriter()
    .on("#root", {
      element: (element): void => {
        element.setAttribute("data-duration", String(plan.duration));
      },
    })
    .on("#title-text, #stage-title", {
      element: (element): void => {
        element.setInnerContent(title);
      },
    })
    .on("#stage-address", {
      element: (element): void => {
        element.setInnerContent(film.address);
      },
    })
    .on("#stage-clips", {
      element: (element): void => {
        element.setInnerContent(clips.join("\n"), { html: true });
      },
    })
    .on("#cues", {
      element: (element): void => {
        element.setInnerContent(cues.join("\n"), { html: true });
      },
    })
    .on("#narration", {
      element: (element): void => {
        element.setInnerContent(narration.join("\n"), { html: true });
      },
    })
    .on("#music", {
      element: (element): void => {
        element.setAttribute("data-duration", String(plan.duration));
        element.setAttribute("data-automation", lane);
      },
    })
    .on("script#guide-film", {
      element: (element): void => {
        // The data holds numbers and the clip names checked above, so nothing in it can end the script early.
        element.setInnerContent(`window.__guideFilm = ${data};`, { html: true });
      },
    })
    .transform(new Response(template))
    .text();
}
