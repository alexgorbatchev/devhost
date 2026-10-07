import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "bun:test";
import { publishGuideDemo } from "../publishGuideDemo";
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
      "color=c=blue:s=1280x860:d=1",
      "-c:v",
      "libx264",
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
    expect(await Bun.file(join(publishedPath, "example.mp4")).bytes()).toEqual(
      await Bun.file(join(recordingPath, "devhost-demo.mp4")).bytes(),
    );
    expect((await Bun.file(join(publishedPath, "example.webp")).bytes()).length).toBeGreaterThan(0);
    expect(await Bun.file(join(publishedPath, "example.vtt")).text()).toBe(
      "WEBVTT\n\n00:00.000 --> 00:01.000\nStart the service.\n",
    );
  } finally {
    await rm(repositoryPath, { recursive: true, force: true });
  }
}, 30_000);
