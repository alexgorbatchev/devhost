import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createGuideComposition } from "./createGuideComposition";
import { planGuideFilm } from "./planGuideFilm";
import { readGuideNarration } from "./readGuideNarration";
import { readMediaInfo } from "./readMediaInfo";
import { readPromoSources } from "./readPromoSources";
import { renderPromo } from "./renderPromo";
import type {
  IGuideAudioTimings,
  IGuideClipInput,
  IGuideRecord,
  IPromoLineTiming,
  IRenderGuideFilmOptions,
} from "./types";

// Renders one guide as a film: a title card, its recorded clips under their narration, and an end card.
export async function renderGuideFilm(options: IRenderGuideFilmOptions): Promise<string> {
  const { directoryPath, filmPath, slug, signal } = options;
  const record: IGuideRecord = { slug, title: options.title, address: options.address, clips: [...options.clips] };
  // Kept before anything can fail, so a run whose render failed can be rendered again.
  await Bun.write(join(directoryPath, "guide.json"), JSON.stringify(record, null, 2) + "\n");
  const templatePath = join(filmPath, "guide");
  const script = (await readGuideNarration(templatePath)).guides[slug];
  if (script === undefined) throw new Error(`guide/narration.json has no guide named ${slug}`);
  const recorded = options.clips.map((clip) => clip.clip);
  const narrated = script.clips.map((line) => line.clip);
  if (recorded.join(" ") !== narrated.join(" ")) {
    throw new Error(
      `The ${slug} guide recorded the clips ${recorded.join(", ")}, but its narration has lines for ` +
        `${narrated.join(", ")}: update guide/narration.json and generate the guide audio`,
    );
  }
  const timingsFile = Bun.file(join(templatePath, "assets/audio/timings.json"));
  const timings: IGuideAudioTimings = (await timingsFile.exists()) ? await timingsFile.json() : { guides: {} };
  const spoken = timings.guides[slug] ?? [];
  const readLine = (id: string): IPromoLineTiming => {
    const line = spoken.find((candidate) => candidate.id === id);
    if (line === undefined) throw new Error(`No narration audio for ${slug} ${id}: run \`just demo audio-guides\``);
    return line;
  };
  if (timings.music === undefined) throw new Error("The guide films have no music: run `just demo audio-guides`");

  const sources = await readPromoSources(directoryPath);
  const clips: IGuideClipInput[] = [];
  for (const [index, clip] of options.clips.entries()) {
    const { footage } = clip;
    const source = sources.find((candidate) => candidate.id === footage.sourceId);
    if (source === undefined) throw new Error(`${directoryPath} has no recording named ${footage.sourceId}`);
    // A window names its own length; a whole recording is measured.
    const sourceSeconds =
      footage.from !== undefined && footage.to !== undefined
        ? footage.to - footage.from
        : (await readMediaInfo(source.path, signal)).duration;
    clips.push({
      ...clip,
      text: script.clips[index]?.text ?? "",
      sourceSeconds,
      narrationSeconds: readLine(clip.clip).duration,
    });
  }
  const plan = planGuideFilm({ text: script.intro, narrationSeconds: readLine("intro").duration }, clips);
  if (timings.music.duration < plan.duration) {
    throw new Error(`The guide music lasts ${timings.music.duration}s, but the ${slug} film lasts ${plan.duration}s`);
  }

  // The film is rendered from a project of its own: the template filled for this guide, with only its audio.
  const projectSourcePath = join(directoryPath, "guide-source");
  await rm(projectSourcePath, { recursive: true, force: true });
  try {
    const lines: IPromoLineTiming[] = [];
    for (const id of ["intro", ...narrated]) {
      const line = readLine(id);
      const path = `assets/audio/voice/${id}.mp3`;
      await Bun.write(join(projectSourcePath, path), Bun.file(join(templatePath, line.path)));
      lines.push({ ...line, path });
    }
    await Bun.write(
      join(projectSourcePath, "assets/audio/music.mp3"),
      Bun.file(join(templatePath, timings.music.path)),
    );
    await Bun.write(join(projectSourcePath, "assets/audio/timings.json"), JSON.stringify({ lines }, null, 2) + "\n");
    await Bun.write(
      join(projectSourcePath, "narration.json"),
      JSON.stringify(
        {
          lines: [
            { id: "intro", text: script.intro },
            ...script.clips.map((line) => ({ id: line.clip, text: line.text })),
          ],
        },
        null,
        2,
      ) + "\n",
    );
    await Bun.write(
      join(projectSourcePath, "index.html"),
      await createGuideComposition(await Bun.file(join(templatePath, "index.html")).text(), {
        title: options.title,
        address: options.address,
        plan,
        lines,
      }),
    );
    // One pinned HyperFrames release renders the promo and every guide.
    for (const file of ["package.json", "hyperframes.json"]) {
      await Bun.write(join(projectSourcePath, file), Bun.file(join(filmPath, "promo", file)));
    }
    await Bun.write(join(projectSourcePath, "meta.json"), JSON.stringify({ id: "guide", name: slug }, null, 2) + "\n");
    const videoPath = await renderPromo({
      directoryPath,
      projectSourcePath,
      projectName: "guide",
      render: options.render,
      signal,
    });
    // The guide page's transcript is what the film says.
    await Bun.write(
      join(directoryPath, "clips.json"),
      JSON.stringify({
        clips: [script.intro, ...script.clips.map((line) => line.text)].map((caption) => ({ caption })),
      }) + "\n",
    );
    return videoPath;
  } finally {
    await rm(projectSourcePath, { recursive: true, force: true });
  }
}
