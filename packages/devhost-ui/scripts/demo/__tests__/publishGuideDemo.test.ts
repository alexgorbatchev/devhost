import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "bun:test";
import { publishGuideDemo } from "../publishGuideDemo";
import { readMediaInfo } from "../readMediaInfo";
import { runCommand } from "../runCommand";

it("publishes playable media and refreshes a guide's first video without duplicating its prose", async () => {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/demo-tests");
  await mkdir(parentPath, { recursive: true });
  const repositoryPath = await mkdtemp(join(parentPath, "publish-"));
  const guidePath = join(repositoryPath, "packages/docs/src/content/docs/guides/example.md");
  const recordingPath = join(repositoryPath, "recording");
  await mkdir(recordingPath, { recursive: true });
  await mkdir(join(repositoryPath, "packages/docs/src/content/docs/guides"), { recursive: true });
  try {
    await Bun.write(guidePath, '---\ntitle: "Example"\n---\n\nOriginal guide prose.\n');
    await runCommand([
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1920x1080:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
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
    await Bun.write(join(recordingPath, "devhost-demo.srt"), "1\n00:00:00,000 --> 00:00:01,000\nStart the service.\n");
    await Bun.write(join(recordingPath, "clips.json"), JSON.stringify({ clips: [{ caption: "Start the service." }] }));
    await publishGuideDemo(repositoryPath, "example", recordingPath);
    await Bun.write(join(recordingPath, "clips.json"), JSON.stringify({ clips: [{ caption: "Stop the service." }] }));
    await publishGuideDemo(repositoryPath, "example", recordingPath);
    const markdown = await Bun.file(guidePath).text();
    const videoAttributes: Record<string, string | null> = {};
    const videoUrls: string[] = [];
    await new HTMLRewriter()
      .on("video", {
        element: (element) => {
          for (const name of ["controls", "preload", "playsinline", "autoplay"])
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
    expect(videoAttributes).toEqual({ controls: "", preload: "none", playsinline: "", autoplay: null });
    expect(videoUrls).toEqual([
      "https://alexgorbatchev.github.io/devhost/demos/example.mp4",
      "https://alexgorbatchev.github.io/devhost/demos/example.vtt",
    ]);
    expect(markdown.split("Original guide prose.").length).toBe(2);
    expect(markdown.split("<video ").length).toBe(2);
    expect(markdown.indexOf("<video ") < markdown.indexOf("Original guide prose.")).toBe(true);
    expect(markdown.split("Stop the service.").length).toBe(2);
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
    expect((await readMediaInfo(join(publishedPath, "example.mp4"))).duration).toBeCloseTo(1, 1);
    const published = Buffer.from(await Bun.file(join(publishedPath, "example.mp4")).bytes());
    expect(published.length).toBeLessThan(Bun.file(join(recordingPath, "devhost-demo.mp4")).size / 2);
    // The index comes before the media, so playback starts while the file is still downloading.
    expect(published.indexOf("moov")).toBeLessThan(published.indexOf("mdat"));
    expect((await Bun.file(join(publishedPath, "example.webp")).bytes()).length).toBeGreaterThan(0);
    expect(await Bun.file(join(publishedPath, "example.vtt")).text()).toBe(
      "WEBVTT\n\n00:00.000 --> 00:01.000\nStart the service.\n",
    );
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
}, 30_000);
