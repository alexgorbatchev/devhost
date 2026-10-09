import assert from "node:assert/strict";
import { cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promoMaximumSeconds } from "./constants";
import { createPromoCaptions } from "./createPromoCaptions";
import { findPromoRecording } from "./findPromoRecording";
import { readMediaInfo } from "./readMediaInfo";
import { preparePromoRenderer } from "./preparePromoRenderer";
import { readPromoFootageRequests } from "./readPromoFootageRequests";
import { readPromoSources } from "./readPromoSources";
import { renderPromoComposition } from "./renderPromoComposition";
import { runCommand } from "./runCommand";
import { stagePromoFootage } from "./stagePromoFootage";
import type { IRenderPromoOptions } from "./types";

// The composition loads these from its own assets, so a render reads nothing from the network.
const stagedDependencies: Record<string, string> = {
  "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2":
    "assets/fonts/jetbrains-mono-latin-wght-normal.woff2",
  "gsap/dist/gsap.min.js": "assets/vendor/gsap.min.js",
  "@alexgorbatchev/devhost-design/tokens.css": "assets/vendor/devhost-tokens.css",
};

export async function renderPromo(options: IRenderPromoOptions): Promise<string> {
  const { directoryPath, signal } = options;
  const projectPath = join(directoryPath, "promo");
  // A wrong directory fails here, before anything in it is created or removed.
  if (resolve(projectPath) === resolve(options.projectSourcePath)) {
    throw new Error(`${directoryPath} holds the promo's own project, so it cannot be a recording`);
  }
  const sources = await readPromoSources(directoryPath);
  const requests = await readPromoFootageRequests(options.projectSourcePath);
  const missing = [...new Set(requests.map((request) => request.slot.sourceId))].filter(
    (sourceId) => !sources.some((source) => source.id === sourceId),
  );
  if (missing.length > 0) {
    throw new Error(`${directoryPath} is not a recording the promo can render from: it has no ${missing.join(", ")}`);
  }
  // Each run renders its own copy, so concurrent recordings and the checkout never share staged footage.
  await rm(projectPath, { recursive: true, force: true });
  await cp(options.projectSourcePath, projectPath, { recursive: true });
  for (const [specifier, target] of Object.entries(stagedDependencies)) {
    await Bun.write(join(projectPath, target), Bun.file(Bun.resolveSync(specifier, import.meta.dir)));
  }
  const footage = await stagePromoFootage(projectPath, sources, signal);
  await Bun.write(join(directoryPath, "promo-footage.json"), JSON.stringify(footage, null, 2) + "\n");
  const outputPath = join(directoryPath, "devhost-demo.mp4");
  await options.render(projectPath, outputPath, signal);
  const media = await readMediaInfo(outputPath);
  assert(
    media.duration <= promoMaximumSeconds,
    `The promo lasts ${media.duration.toFixed(1)}s; the limit is ${promoMaximumSeconds}s`,
  );
  const audioStreams = await runCommand([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=codec_name",
    "-of",
    "csv=p=0",
    outputPath,
  ]);
  assert(audioStreams.trim() !== "", "The promo has no audio track");
  const narration: unknown = await Bun.file(join(projectPath, "narration.json")).json();
  assert(typeof narration === "object" && narration !== null && "lines" in narration && Array.isArray(narration.lines));
  await Bun.write(
    join(directoryPath, "devhost-demo.srt"),
    await createPromoCaptions(
      await Bun.file(join(projectPath, "index.html")).text(),
      narration.lines,
      await Bun.file(join(projectPath, "assets/audio/timings.json")).json(),
    ),
  );
  await runCommand([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    // The closing card carries the name and the address.
    String(Math.max(0, media.duration - 1.5)),
    "-i",
    outputPath,
    "-frames:v",
    "1",
    join(directoryPath, "poster.png"),
  ]);
  return outputPath;
}

if (import.meta.main) {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("Promo render interrupted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const selected = process.env.DEVHOST_DEMO_RECORDING ?? "";
    const projectSourcePath = join(import.meta.dir, "promo");
    const requests = await readPromoFootageRequests(projectSourcePath);
    const directoryPath =
      selected === ""
        ? await findPromoRecording(resolve(import.meta.dir, "../../../../.tmp/demos"), [
            ...new Set(requests.map((request) => request.slot.sourceId)),
          ])
        : // A relative path means what it meant where `just` was invoked, not in this recipe's directory.
          resolve(process.env.DEVHOST_DEMO_INVOCATION_DIRECTORY ?? process.cwd(), selected);
    // The preflight works beside the recordings, so a wrong directory argument is not written to.
    const recordingsPath = resolve(import.meta.dir, "../../../../.tmp/demos");
    await preparePromoRenderer(runCommand, projectSourcePath, recordingsPath, controller.signal);
    console.log(`Rendering the promo from ${directoryPath}`);
    const outputPath = await renderPromo({
      directoryPath,
      projectSourcePath,
      render: renderPromoComposition,
      signal: controller.signal,
    });
    console.log(`Promo saved: ${outputPath}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
