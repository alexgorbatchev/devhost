import assert from "node:assert/strict";
import { join } from "node:path";
import { z } from "zod";
import { createDemoVideoBlock } from "./createDemoVideoBlock";
import { exportDemoMedia } from "./exportDemoMedia";

const planSchema = z.object({ poster: z.number().nonnegative() });

export async function publishGuideDemo(repositoryPath: string, slug: string, recordingPath: string): Promise<void> {
  assert(/^[a-z][a-z0-9-]*$/.test(slug), "Invalid guide slug");
  const guidePath = join(repositoryPath, "packages/docs/src/content/docs/guides", `${slug}.md`);
  const original = await Bun.file(guidePath).text();
  const frontmatterEnd = original.indexOf("\n---\n", 4);
  assert(original.startsWith("---\n") && frontmatterEnd > 0, "Guide has no frontmatter");
  const planFile = Bun.file(join(recordingPath, "guide-film.json"));
  if (!(await planFile.exists())) throw new Error(`${planFile.name} is missing: render the guide film again`);
  const { poster } = planSchema.parse(await planFile.json());
  const media = await exportDemoMedia(repositoryPath, slug, recordingPath, ({ duration }) => {
    assert(poster < duration, `${planFile.name} plans a film longer than the ${duration}s one in ${recordingPath}`);
    return poster;
  });
  const block = createDemoVideoBlock({
    marker: "guide-demo",
    name: slug,
    label: `${slug.replaceAll("-", " ")} demo`,
    media,
  });
  const body = original
    .slice(frontmatterEnd + 5)
    .replace(/\n?<!-- guide-demo -->[\s\S]*?<!-- \/guide-demo -->\n?/u, "")
    .trimStart();
  await Bun.write(guidePath, `${original.slice(0, frontmatterEnd + 5)}\n${block}\n\n${body}`);
}
