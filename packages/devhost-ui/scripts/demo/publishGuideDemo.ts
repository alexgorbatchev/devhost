import assert from "node:assert/strict";
import { join } from "node:path";
import { createDemoVideoBlock } from "./createDemoVideoBlock";
import { exportDemoMedia } from "./exportDemoMedia";

export async function publishGuideDemo(repositoryPath: string, slug: string, recordingPath: string): Promise<void> {
  assert(/^[a-z][a-z0-9-]*$/.test(slug), "Invalid guide slug");
  const guidePath = join(repositoryPath, "packages/docs/src/content/docs/guides", `${slug}.md`);
  const original = await Bun.file(guidePath).text();
  const frontmatterEnd = original.indexOf("\n---\n", 4);
  assert(original.startsWith("---\n") && frontmatterEnd > 0, "Guide has no frontmatter");
  const metadata: unknown = await Bun.file(join(recordingPath, "clips.json")).json();
  assert(typeof metadata === "object" && metadata !== null && "clips" in metadata && Array.isArray(metadata.clips));
  const captions = metadata.clips.map((clip: unknown): string => {
    assert(typeof clip === "object" && clip !== null && "caption" in clip && typeof clip.caption === "string");
    return clip.caption;
  });
  assert(captions.length > 0, "Demo has no transcript");
  const media = await exportDemoMedia(repositoryPath, slug, recordingPath, ({ duration }) => Math.min(2, duration / 2));
  const block = createDemoVideoBlock({
    marker: "guide-demo",
    name: slug,
    label: `${slug.replaceAll("-", " ")} demo`,
    media,
    transcript: captions,
  });
  const body = original
    .slice(frontmatterEnd + 5)
    .replace(/\n?<!-- guide-demo -->[\s\S]*?<!-- \/guide-demo -->\n?/u, "")
    .trimStart();
  await Bun.write(guidePath, `${original.slice(0, frontmatterEnd + 5)}\n${block}\n\n${body}`);
}
