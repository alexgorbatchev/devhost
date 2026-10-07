import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { chromium, type Browser } from "playwright";
import { assembleDemo } from "./assembleDemo";
import { cleanupDemoRuntime } from "./cleanupDemoRuntime";
import { createBrowserScenes } from "./createBrowserScenes";
import { createDemoRuntime } from "./createDemoRuntime";
import { createDemoPage } from "./createDemoPage";
import { exportClip } from "./exportClip";
import { prepareDemoCaddy } from "./prepareDemoCaddy";
import { recordBrowserScene } from "./recordBrowserScene";
import { runCommand } from "./runCommand";
import { startDemoStack } from "./startDemoStack";
import { stopProcess } from "./stopProcess";
import type { RecordedClip } from "./types";

export async function recordDemo(signal: AbortSignal): Promise<string> {
  const repositoryPath = resolve(import.meta.dir, "../../../..");
  const selectedScene = process.env.DEVHOST_DEMO_SCENE ?? "all";
  const scenes = createBrowserScenes();
  if (!["all", "startup", ...scenes.map((scene) => scene.id)].includes(selectedScene)) {
    throw new Error("Choose a scene: all, startup, overview, annotations, query");
  }
  const dependencies = ["bun", "just", "git", "caddy", "ffmpeg", "ffprobe", "vhs", "ttyd", "bash", "ln"];
  if (selectedScene === "all" || selectedScene === "annotations") dependencies.push("pi");
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
  const clips: RecordedClip[] = [];
  let stack: Subprocess | undefined;
  let browser: Browser | undefined;
  let recordingError: unknown;
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
      join(repositoryPath, "apps/devhost/dist/devhost"),
      join(runtime.directoryPath, "bin/devhost"),
    ]);
    await prepareDemoCaddy(runtime, signal);
    if (selectedScene === "all" || selectedScene === "startup") {
      console.log("Recording startup...");
      const tapePath = join(runtime.directoryPath, "startup.tape");
      await Bun.write(tapePath, Bun.file(join(import.meta.dir, "startup.tape")));
      await runCommand(["vhs", "validate", tapePath], { cwd: runtime.directoryPath, env: runtime.env, signal });
      await runCommand(["vhs", tapePath], {
        cwd: runtime.directoryPath,
        env: runtime.env,
        signal,
        logPath: join(runtime.directoryPath, "vhs.log"),
      });
      clips.push(
        await exportClip(
          runtime.directoryPath,
          "startup",
          join(runtime.directoryPath, "raw/startup.mp4"),
          "Start the whole stack with local domains and browser devtools.",
        ),
      );
    }
    const selectedBrowserScenes = scenes.filter((scene) => selectedScene === "all" || scene.id === selectedScene);
    if (selectedBrowserScenes.length > 0) {
      stack = await startDemoStack(runtime, signal);
      browser = await chromium.launch({ env: runtime.env });
      const page = await createDemoPage(browser, runtime);
      for (const scene of selectedBrowserScenes) {
        signal.throwIfAborted();
        console.log(`Recording ${scene.id}...`);
        const sources = await recordBrowserScene(page, scene, runtime, signal);
        for (const source of sources) {
          clips.push(await exportClip(runtime.directoryPath, source.id, source.path, source.caption));
        }
      }
    }
    signal.throwIfAborted();
    console.log("Assembling captioned MP4...");
    return await assembleDemo(runtime.directoryPath, clips);
  } catch (error) {
    recordingError = error;
    await Bun.write(
      join(runtime.directoryPath, "recording-error.log"),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    throw error;
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
      throw new AggregateError(
        recordingError === undefined ? failures : [recordingError, ...failures],
        "Recording cleanup failed",
      );
    }
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("Recording interrupted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    console.log(`Recording saved: ${await recordDemo(controller.signal)}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
