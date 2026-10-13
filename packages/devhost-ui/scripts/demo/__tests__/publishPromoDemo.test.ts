import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "bun:test";
import { publishPromoDemo } from "../publishPromoDemo";
import { runCommand } from "../runCommand";

it("publishes the promo's media and a landing-page block that speaks its narration", async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  const repositoryPath = await mkdtemp(join(parentPath, "publish-promo-"));
  const recordingPath = join(repositoryPath, "recording");
  const projectPath = join(repositoryPath, "promo");
  await mkdir(recordingPath, { recursive: true });
  try {
    await runCommand([
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1920x1080:r=30:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-c:v",
      "libx264",
      "-qp",
      "0",
      "-pix_fmt",
      "yuv444p",
      "-shortest",
      join(recordingPath, "devhost-demo.mp4"),
    ]);
    await Bun.write(join(recordingPath, "devhost-demo.srt"), "1\n00:00:00,000 --> 00:00:01,000\nWhich port?\n");
    await Bun.write(
      join(projectPath, "narration.json"),
      JSON.stringify({
        lines: [
          { id: "line-1", text: "Which <port>?" },
          { id: "line-2", text: "Stop juggling ports." },
        ],
      }),
    );
    await publishPromoDemo(repositoryPath, recordingPath, projectPath);
    await publishPromoDemo(repositoryPath, recordingPath, projectPath);
    const block = await Bun.file(join(repositoryPath, "packages/docs/src/promoDemo.html")).text();
    const video: Record<string, string | null> = {};
    const urls: string[] = [];
    const transcript: string[] = [];
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
      .on("details p", {
        text: (chunk) => {
          transcript.push(chunk.text);
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
    expect(transcript.join("")).toBe("Which &lt;port&gt;?Stop juggling ports.");
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
    expect((await Bun.file(join(publishedPath, "promo.webp")).bytes()).length).toBeGreaterThan(0);
    expect(await Bun.file(join(publishedPath, "promo.vtt")).text()).toBe(
      "WEBVTT\n\n00:00.000 --> 00:01.000\nWhich port?\n",
    );
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
}, 30_000);

it("rejects a promo whose narration has no lines", async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  const repositoryPath = await mkdtemp(join(parentPath, "publish-promo-"));
  try {
    await Bun.write(join(repositoryPath, "promo/narration.json"), JSON.stringify({ lines: [] }));
    await expect(
      publishPromoDemo(repositoryPath, join(repositoryPath, "recording"), join(repositoryPath, "promo")),
    ).rejects.toThrow("The promo's narration has no lines");
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
});
