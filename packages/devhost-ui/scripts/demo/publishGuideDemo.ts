import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readMediaInfo } from "./readMediaInfo";
import { runCommand } from "./runCommand";

export async function publishGuideDemo(repositoryPath: string, slug: string, recordingPath: string): Promise<void> {
  assert(/^[a-z][a-z0-9-]*$/.test(slug), "Invalid guide slug");
  const guidePath = join(repositoryPath, "packages/docs/src/content/docs/guides", `${slug}.md`);
  const original = await Bun.file(guidePath).text();
  const frontmatterEnd = original.indexOf("\n---\n", 4);
  assert(original.startsWith("---\n") && frontmatterEnd > 0, "Guide has no frontmatter");
  const videoPath = join(recordingPath, "devhost-demo.mp4");
  const media = await readMediaInfo(videoPath);
  const metadata: unknown = await Bun.file(join(recordingPath, "clips.json")).json();
  assert(typeof metadata === "object" && metadata !== null && "clips" in metadata && Array.isArray(metadata.clips));
  const captions = metadata.clips.map((clip: unknown): string => {
    assert(typeof clip === "object" && clip !== null && "caption" in clip && typeof clip.caption === "string");
    return clip.caption;
  });
  assert(captions.length > 0, "Demo has no transcript");
  const publicPath = join(repositoryPath, "packages/docs/public/demos");
  await mkdir(publicPath, { recursive: true });
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-ss",
    String(Math.min(2, media.duration / 2)),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    join(publicPath, `${slug}.webp`),
  ]);
  await runCommand([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    join(recordingPath, "devhost-demo.srt"),
    join(publicPath, `${slug}.vtt`),
  ]);
  await Bun.write(join(publicPath, `${slug}.mp4`), Bun.file(videoPath));
  const url = `https://alexgorbatchev.github.io/devhost/demos/${slug}`;
  const block = [
    "<!-- guide-demo -->",
    `<video controls playsinline preload="none" width="${media.width}" height="${media.height}" style="width:100%;height:auto" poster="${url}.webp" aria-label="${slug.replaceAll("-", " ")} demo">`,
    `  <source src="${url}.mp4" type="video/mp4">`,
    `  <track kind="captions" src="${url}.vtt" srclang="en" label="English">`,
    `  <a href="${url}.mp4">Watch the demo video</a>.`,
    "</video>",
    "",
    "<details>",
    "<summary>Demo transcript</summary>",
    ...captions.map((caption) => `<p>${Bun.escapeHTML(caption)}</p>`),
    "</details>",
    "<!-- /guide-demo -->",
  ].join("\n");
  const body = original
    .slice(frontmatterEnd + 5)
    .replace(/\n?<!-- guide-demo -->[\s\S]*?<!-- \/guide-demo -->\n?/u, "")
    .trimStart();
  await Bun.write(guidePath, `${original.slice(0, frontmatterEnd + 5)}\n${block}\n\n${body}`);
}
