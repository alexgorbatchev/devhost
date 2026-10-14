import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "bun:test";
import { planGuideFilm } from "../planGuideFilm";
import { publishGuideDemo } from "../publishGuideDemo";
import { readMediaInfo } from "../readMediaInfo";
import { runCommand } from "../runCommand";
import type { IGuideFilmPlan } from "../types";
import { createColorFilm } from "./fixtures/createColorFilm";
import { readPosterColor } from "./fixtures/readPosterColor";

function createPlan(stepSeconds: number[]): IGuideFilmPlan {
  return planGuideFilm(
    { text: "Start a stack.", narrationSeconds: 1 },
    stepSeconds.map((sourceSeconds, index) => ({
      clip: `step-${index + 1}`,
      text: `Step ${index + 1}.`,
      footage: { sourceId: "guide" },
      sourceSeconds,
      narrationSeconds: 0.2,
    })),
  );
}

interface IGuideFixture {
  repositoryPath: string;
  guidePath: string;
  recordingPath: string;
}

async function createGuide(name: string): Promise<IGuideFixture> {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  const repositoryPath = await mkdtemp(join(parentPath, name));
  const guidePath = join(repositoryPath, "packages/docs/src/content/docs/guides/example.md");
  const recordingPath = join(repositoryPath, "recording");
  await mkdir(recordingPath, { recursive: true });
  await Bun.write(guidePath, '---\ntitle: "Example"\n---\n\nOriginal guide prose.\n');
  await Bun.write(join(recordingPath, "devhost-demo.srt"), "1\n00:00:00,000 --> 00:00:01,000\nStart the service.\n");
  return { repositoryPath, guidePath, recordingPath };
}

it("publishes playable media and refreshes a guide's first video without duplicating its prose", async () => {
  const { repositoryPath, guidePath, recordingPath } = await createGuide("publish-");
  const plan = createPlan([0.5]);
  try {
    await runCommand([
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=1920x1080:r=30:d=${plan.duration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${plan.duration}`,
      // A master as a renderer may leave it: lossless, in a pixel format browsers do not play.
      "-c:v",
      "libx264",
      "-qp",
      "0",
      "-pix_fmt",
      "yuv444p",
      "-shortest",
      join(recordingPath, "devhost-demo.mp4"),
    ]);
    await Bun.write(join(recordingPath, "guide-film.json"), JSON.stringify(plan));
    await publishGuideDemo(repositoryPath, "example", recordingPath);
    await publishGuideDemo(repositoryPath, "example", recordingPath);
    const markdown = await Bun.file(guidePath).text();
    const videoAttributes: Record<string, string | null> = {};
    const videoUrls: string[] = [];
    await new HTMLRewriter()
      .on("video", {
        element: (element) => {
          for (const name of ["controls", "preload", "playsinline", "autoplay", "poster"])
            videoAttributes[name] = element.getAttribute(name);
        },
      })
      .on("source, track", {
        element: (element) => {
          const url = element.getAttribute("src");
          assert(url);
          videoUrls.push(url);
        },
      })
      .transform(new Response(markdown))
      .text();
    expect(videoAttributes).toEqual({
      controls: "",
      preload: "none",
      playsinline: "",
      autoplay: null,
      poster: "https://alexgorbatchev.github.io/devhost/demos/example.webp",
    });
    expect(videoUrls).toEqual([
      "https://alexgorbatchev.github.io/devhost/demos/example.mp4",
      "https://alexgorbatchev.github.io/devhost/demos/example.vtt",
    ]);
    // The block is the player alone, followed by the guide's prose once.
    expect(markdown).toBe(
      [
        "---",
        'title: "Example"',
        "---",
        "",
        "<!-- guide-demo -->",
        '<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/example.webp" aria-label="example demo">',
        '  <source src="https://alexgorbatchev.github.io/devhost/demos/example.mp4" type="video/mp4">',
        '  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/example.vtt" srclang="en" label="English">',
        '  <a href="https://alexgorbatchev.github.io/devhost/demos/example.mp4">Watch the demo video</a>.',
        "</video>",
        "<!-- /guide-demo -->",
        "",
        "Original guide prose.",
        "",
      ].join("\n"),
    );
    const publishedPath = join(repositoryPath, "packages/docs/public/demos");
    // The page's video is an encode for the web that keeps the film's picture size, length and sound.
    expect(
      await runCommand([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height,pix_fmt",
        "-of",
        "csv=p=0",
        join(publishedPath, "example.mp4"),
      ]),
    ).toBe("h264,1920,1080,yuv420p\naac\n");
    expect((await readMediaInfo(join(publishedPath, "example.mp4"))).duration).toBeCloseTo(plan.duration, 1);
    const published = Buffer.from(await Bun.file(join(publishedPath, "example.mp4")).bytes());
    expect(published.length).toBeLessThan(Bun.file(join(recordingPath, "devhost-demo.mp4")).size / 2);
    // The index comes before the media, so playback starts while the file is still downloading.
    expect(published.indexOf("moov")).toBeLessThan(published.indexOf("mdat"));
    expect(await Bun.file(join(publishedPath, "example.vtt")).text()).toBe(
      "WEBVTT\n\n00:00.000 --> 00:01.000\nStart the service.\n",
    );
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
}, 30_000);

it("shows the end of the guide's first step as the video's poster", async () => {
  const { repositoryPath, recordingPath } = await createGuide("publish-poster-");
  try {
    const plan = createPlan([1, 1]);
    const [first, second] = plan.beats;
    assert(first && second);
    // The title card is gray and the first step green; the second step is blue, and the end card is black.
    await createColorFilm(
      join(recordingPath, "devhost-demo.mp4"),
      new Map([
        ["gray", plan.introSeconds],
        ["lime", first.duration],
        ["blue", second.duration],
        ["black", plan.outroSeconds],
      ]),
    );
    await Bun.write(join(recordingPath, "guide-film.json"), JSON.stringify(plan));
    await publishGuideDemo(repositoryPath, "example", recordingPath);
    const color = await readPosterColor(join(repositoryPath, "packages/docs/public/demos/example.webp"));
    expect(color.map((channel) => Math.round(channel / 255))).toEqual([0, 1, 0]);
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
}, 30_000);

it("shows the frame the film plan names as the video poster", async () => {
  const { repositoryPath, recordingPath } = await createGuide("publish-marked-poster-");
  try {
    const plan = createPlan([1, 1]);
    const [first, second] = plan.beats;
    assert(first && second);
    await createColorFilm(
      join(recordingPath, "devhost-demo.mp4"),
      new Map([
        ["gray", plan.introSeconds],
        ["lime", first.duration],
        ["blue", second.duration],
        ["black", plan.outroSeconds],
      ]),
    );
    // A clip marked a frame of the second step.
    const marked: IGuideFilmPlan = { ...plan, poster: second.start + second.duration / 2 };
    await Bun.write(join(recordingPath, "guide-film.json"), JSON.stringify(marked));
    await publishGuideDemo(repositoryPath, "example", recordingPath);
    const color = await readPosterColor(join(repositoryPath, "packages/docs/public/demos/example.webp"));
    expect(color.map((channel) => Math.round(channel / 255))).toEqual([0, 0, 1]);
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
}, 30_000);

it("rejects a guide run that has no plan of its film", async () => {
  const { repositoryPath, recordingPath } = await createGuide("publish-unplanned-");
  try {
    await expect(publishGuideDemo(repositoryPath, "example", recordingPath)).rejects.toThrow(
      `${join(recordingPath, "guide-film.json")} is missing: render the guide film again`,
    );
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
});
