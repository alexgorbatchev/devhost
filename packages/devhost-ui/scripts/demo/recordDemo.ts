import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import type { Browser } from "playwright";
import { assembleDemo } from "./assembleDemo";
import { cleanupDemoRuntime } from "./cleanupDemoRuntime";
import { promoCaptureScale } from "./constants";
import { createBrowserScenes } from "./createBrowserScenes";
import { createDemoRuntime } from "./createDemoRuntime";
import { createDemoPage } from "./createDemoPage";
import { exportClip } from "./exportClip";
import { launchDemoBrowser } from "./launchDemoBrowser";
import { prepareDemoCaddy } from "./prepareDemoCaddy";
import { recordBrowserScene } from "./recordBrowserScene";
import { renderPromo } from "./renderPromo";
import { renderPromoComposition } from "./renderPromoComposition";
import { runCommand } from "./runCommand";
import { scaleTape } from "./scaleTape";
import { startDemoStack } from "./startDemoStack";
import { stopProcess } from "./stopProcess";
import type { IRecordedClip } from "./types";

export async function recordDemo(signal: AbortSignal, selectedScene: string): Promise<string> {
  const repositoryPath = resolve(import.meta.dir, "../../../..");
  const scenes = createBrowserScenes();
  if (!["all", "startup", "devtools", ...scenes.map((scene) => scene.id)].includes(selectedScene)) {
    throw new Error("Choose a scene: all, startup, overview, annotations, query, devtools, react-highlight");
  }
  // The full sequence becomes the promo: real scenes captured at twice the pixel density, composed by HyperFrames.
  const isPromo = selectedScene === "all";
  const captureScale = isPromo ? promoCaptureScale : 1;
  const dependencies = ["bun", "just", "git", "caddy", "ffmpeg", "ffprobe", "vhs", "ttyd", "bash", "ln"];
  // HyperFrames runs on Node.js; Bun starts it from the promo project's pinned script.
  if (isPromo) dependencies.push("node");
  if (isPromo || selectedScene === "annotations") dependencies.push("pi");
  if (selectedScene === "react-highlight") dependencies.push("nvim");
  for (const executable of dependencies) {
    if (!Bun.which(executable)) throw new Error(`Missing recording dependency: ${executable}`);
  }
  const versions = await Promise.all([
    runCommand(["vhs", "--version"]),
    runCommand(["bun", "--version"]),
    runCommand(["ffmpeg", "-version"]),
  ]);
  console.log("Building devhost and its embedded UI...");
  await runCommand(["just", "devhost", "compile"], { cwd: repositoryPath, signal });
  const runtime = await createDemoRuntime(repositoryPath, process.env.DEVHOST_DEMO_HOST ?? "demo.localhost");
  if (selectedScene === "react-highlight") {
    const manifest = await Bun.file(runtime.manifestPath).text();
    await Bun.write(
      runtime.manifestPath,
      manifest.replace("[devtools.editor]\nenabled = false", "[devtools.editor]\nenabled = true"),
    );
  }
  console.log(`Recording artifacts: ${runtime.directoryPath}`);
  await Bun.write(
    join(runtime.directoryPath, "versions.json"),
    JSON.stringify(
      {
        vhs: versions[0]?.trim(),
        bun: versions[1]?.trim(),
        ffmpeg: versions[2]?.split("\n")[0],
        playwright: (await Bun.file(resolve(import.meta.dir, "../../node_modules/playwright/package.json")).json())
          .version,
        revision: (await runCommand(["git", "rev-parse", "HEAD"], { cwd: repositoryPath })).trim(),
      },
      null,
      2,
    ) + "\n",
  );
  const clips: IRecordedClip[] = [];
  let stack: Subprocess | undefined;
  let browser: Browser | undefined;
  let recordingError: unknown;
  let cleanupError: AggregateError | undefined;
  let videoPath: string | undefined;
  const originalDirectory = process.cwd();
  const originalTemporaryDirectory = process.env.TMPDIR;
  const closeBrowser = (): void => {
    void browser?.close().catch(() => {});
  };
  signal.addEventListener("abort", closeBrowser, { once: true });
  try {
    // Relative paths keep Chromium's filesystem socket names within Linux's 108-byte limit in deep worktrees.
    process.chdir(runtime.directoryPath);
    process.env.TMPDIR = ".tmp";
    await runCommand([
      "ln",
      "-s",
      join(repositoryPath, "apps/devhost/bin/devhost"),
      join(runtime.directoryPath, "bin/devhost"),
    ]);
    await prepareDemoCaddy(runtime, signal);
    if (selectedScene === "all" || selectedScene === "startup") {
      console.log("Recording startup...");
      const tapePath = join(runtime.directoryPath, "startup.tape");
      await Bun.write(tapePath, scaleTape(await Bun.file(join(import.meta.dir, "startup.tape")).text(), captureScale));
      await runCommand(["vhs", "validate", tapePath], { cwd: runtime.directoryPath, env: runtime.env, signal });
      await runCommand(["vhs", tapePath], {
        cwd: runtime.directoryPath,
        env: runtime.env,
        signal,
        logPath: join(runtime.directoryPath, "vhs.log"),
      });
      if (!isPromo) {
        clips.push(
          await exportClip(
            runtime.directoryPath,
            "startup",
            join(runtime.directoryPath, "raw/startup.mp4"),
            "Start the whole stack with local domains and browser devtools.",
          ),
        );
      }
    }
    const selectedBrowserScenes = scenes.filter(
      (scene) =>
        (selectedScene === "all" && scene.id !== "react-highlight") ||
        (selectedScene === "devtools" && ["overview", "query"].includes(scene.id)) ||
        scene.id === selectedScene,
    );
    if (selectedBrowserScenes.length > 0) {
      stack = await startDemoStack(runtime, signal);
      browser = await launchDemoBrowser(runtime.env, captureScale);
      const page = await createDemoPage(browser, runtime, captureScale);
      for (const scene of selectedBrowserScenes) {
        signal.throwIfAborted();
        console.log(`Recording ${scene.id}...`);
        const sources = await recordBrowserScene(page, scene, runtime, signal, captureScale);
        if (isPromo) continue;
        for (const source of sources) {
          clips.push(await exportClip(runtime.directoryPath, source.id, source.path, source.caption));
        }
      }
    }
    signal.throwIfAborted();
    if (isPromo) {
      // The render reads only the captured files, so the browser and the stack stop before it starts.
      await browser?.close();
      browser = undefined;
      if (stack) await stopProcess(stack);
      stack = undefined;
      console.log("Rendering the promo...");
      videoPath = await renderPromo({
        directoryPath: runtime.directoryPath,
        projectSourcePath: join(import.meta.dir, "promo"),
        render: renderPromoComposition,
        signal,
      });
    } else {
      console.log("Assembling captioned MP4...");
      videoPath = await assembleDemo(runtime.directoryPath, clips);
    }
  } catch (error) {
    recordingError = error;
    await Bun.write(
      join(runtime.directoryPath, "recording-error.log"),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  } finally {
    signal.removeEventListener("abort", closeBrowser);
    const cleanup = await Promise.allSettled([
      browser?.close(),
      stack === undefined ? Promise.resolve() : stopProcess(stack),
    ]);
    cleanup.push(...(await Promise.allSettled([cleanupDemoRuntime(runtime)])));
    process.chdir(originalDirectory);
    if (originalTemporaryDirectory === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTemporaryDirectory;
    const failures = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length > 0) {
      cleanupError = new AggregateError(
        recordingError === undefined ? failures : [recordingError, ...failures],
        "Recording cleanup failed",
      );
    }
  }
  if (cleanupError) throw cleanupError;
  if (recordingError !== undefined) throw recordingError;
  assert(videoPath, "Recording produced no video");
  return videoPath;
}

if (import.meta.main) {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("Recording interrupted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    console.log(`Recording saved: ${await recordDemo(controller.signal, process.env.DEVHOST_DEMO_SCENE ?? "all")}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
