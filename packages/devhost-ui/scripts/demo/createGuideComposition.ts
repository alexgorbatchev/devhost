import type { IGuideCueLine, IGuideFilm } from "./types";

function round(seconds: number): number {
  return Math.round(seconds * 1_000) / 1_000;
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
    .on("script#guide-film", {
      element: (element): void => {
        // The data holds numbers and the clip names checked above, so nothing in it can end the script early.
        element.setInnerContent(`window.__guideFilm = ${data};`, { html: true });
      },
    })
    .transform(new Response(template))
    .text();
}
