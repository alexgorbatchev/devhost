import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { publishGuideDemo } from "./publishGuideDemo";
import { recordDemo } from "./recordDemo";
import { recordGuideTerminal } from "./recordGuideTerminal";
import { runCommand } from "./runCommand";

export async function recordGuides(signal: AbortSignal, selectedGuide: string): Promise<void> {
  const repositoryPath = resolve(import.meta.dir, "../../../..");
  const guidePath = join(repositoryPath, "packages/docs/src/content/docs/guides");
  const files = await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: guidePath, onlyFiles: true }));
  const slugs = files.map((file) => file.replace(/\.md$/, "")).sort();
  assert(selectedGuide === "all" || slugs.includes(selectedGuide), `Unknown guide: ${selectedGuide}`);
  for (const executable of ["bun", "just", "git", "caddy", "ffmpeg", "ffprobe", "vhs", "ttyd", "curl", "setsid"]) {
    assert(Bun.which(executable), `Missing recording dependency: ${executable}`);
  }
  await runCommand(["just", "devhost", "compile"], { cwd: repositoryPath, signal });
  for (const slug of slugs.filter((slug) => selectedGuide === "all" || slug === selectedGuide)) {
    signal.throwIfAborted();
    console.log(`Recording guide: ${slug}`);
    const path = ["annotations", "devtools", "react-highlight"].includes(slug)
      ? await recordDemo(signal, slug)
      : await recordGuideTerminal(repositoryPath, slug, signal);
    await publishGuideDemo(repositoryPath, slug, dirname(path));
    console.log(`Wrote guide media: packages/docs/public/demos/${slug}.mp4`);
  }
  console.log("Review the videos, then publish them with `just docs publish-media`.");
}

if (import.meta.main) {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort(new Error("Guide recording interrupted"));
  };
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    await recordGuides(controller.signal, process.env.DEVHOST_DEMO_GUIDE ?? "all");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
