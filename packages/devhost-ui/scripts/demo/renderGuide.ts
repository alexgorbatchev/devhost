import { join, resolve } from "node:path";
import { findGuideRecording } from "./findGuideRecording";
import { preparePromoRenderer } from "./preparePromoRenderer";
import { publishGuideDemo } from "./publishGuideDemo";
import { renderGuideFilm } from "./renderGuideFilm";
import { renderPromoComposition } from "./renderPromoComposition";
import { runCommand } from "./runCommand";

// Renders a guide's film again from the footage of its latest recording, and writes it where the docs site serves it.
export async function renderGuide(slug: string, signal: AbortSignal): Promise<string> {
  const repositoryPath = resolve(import.meta.dir, "../../../..");
  const recordingsPath = join(repositoryPath, ".tmp/demos");
  const { directoryPath, record } = await findGuideRecording(recordingsPath, slug);
  await preparePromoRenderer(runCommand, join(import.meta.dir, "promo"), recordingsPath, signal);
  console.log(`Rendering the ${slug} guide film from ${directoryPath}`);
  const videoPath = await renderGuideFilm({
    ...record,
    directoryPath,
    filmPath: import.meta.dir,
    render: renderPromoComposition,
    signal,
  });
  await publishGuideDemo(repositoryPath, slug, directoryPath);
  return videoPath;
}

if (import.meta.main) {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("Guide render interrupted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const slug = process.env.DEVHOST_DEMO_GUIDE ?? "";
    if (slug === "") throw new Error("Name the guide to render, for example: just demo guide-film stack-lifecycle");
    console.log(`Guide film saved: ${await renderGuide(slug, controller.signal)}`);
    console.log("Review the video, then publish it with `just docs publish-media`.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
