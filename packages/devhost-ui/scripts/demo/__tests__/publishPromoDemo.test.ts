import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "bun:test";
import { publishPromoDemo } from "../publishPromoDemo";
import { runCommand } from "../runCommand";
import { createColorFilm } from "./fixtures/createColorFilm";
import { readPosterColor } from "./fixtures/readPosterColor";

it("publishes the promo's media and a landing-page player whose poster is the end card", async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  const repositoryPath = await mkdtemp(join(parentPath, "publish-promo-"));
  const recordingPath = join(repositoryPath, "recording");
  await mkdir(recordingPath, { recursive: true });
  try {
    // The end card, which names devhost and its address, is blue and closes the film.
    await createColorFilm(
      join(recordingPath, "devhost-demo.mp4"),
      new Map([
        ["red", 3],
        ["blue", 1],
      ]),
    );
    await Bun.write(join(recordingPath, "devhost-demo.srt"), "1\n00:00:00,000 --> 00:00:01,000\nWhich port?\n");
    await publishPromoDemo(repositoryPath, recordingPath);
    await publishPromoDemo(repositoryPath, recordingPath);
    const block = await Bun.file(join(repositoryPath, "packages/docs/src/promoDemo.html")).text();
    const video: Record<string, string | null> = {};
    const urls: string[] = [];
    await new HTMLRewriter()
      .on("video", {
        element: (element) => {
          for (const name of ["controls", "preload", "playsinline", "autoplay", "width", "height", "poster"])
            video[name] = element.getAttribute(name);
        },
      })
      .on("source, track", {
        element: (element) => {
          const url = element.getAttribute("src");
          assert(url);
          urls.push(url);
        },
      })
      .transform(new Response(block))
      .text();

    expect(video).toEqual({
      controls: "",
      preload: "none",
      playsinline: "",
      autoplay: null,
      width: "1920",
      height: "1080",
      poster: "https://alexgorbatchev.github.io/devhost/demos/promo.webp",
    });
    expect(urls).toEqual([
      "https://alexgorbatchev.github.io/devhost/demos/promo.mp4",
      "https://alexgorbatchev.github.io/devhost/demos/promo.vtt",
    ]);
    // The block is the player alone.
    expect(block.trimEnd().split("\n").slice(-2)).toEqual(["</video>", "<!-- /promo-demo -->"]);
    const publishedPath = join(repositoryPath, "packages/docs/public/demos");
    expect(
      await runCommand([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height,pix_fmt",
        "-of",
        "csv=p=0",
        join(publishedPath, "promo.mp4"),
      ]),
    ).toBe("h264,1920,1080,yuv420p\naac\n");
    const color = await readPosterColor(join(publishedPath, "promo.webp"));
    expect(color.map((channel) => Math.round(channel / 255))).toEqual([0, 0, 1]);
    expect(await Bun.file(join(publishedPath, "promo.vtt")).text()).toBe(
      "WEBVTT\n\n00:00.000 --> 00:01.000\nWhich port?\n",
    );
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
}, 30_000);
