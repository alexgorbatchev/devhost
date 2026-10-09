import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createPromoRendererEnvironment } from "./createPromoRendererEnvironment";
import { runCommand } from "./runCommand";

export async function renderPromoComposition(
  projectPath: string,
  outputPath: string,
  signal: AbortSignal,
): Promise<void> {
  const temporaryPath = join(dirname(outputPath), ".tmp");
  await mkdir(temporaryPath, { recursive: true });
  // The project's own script pins the HyperFrames release, so `hyperframes upgrade` changes one place.
  await runCommand(
    [
      "bun",
      "run",
      "render",
      "--output",
      outputPath,
      "--quality",
      process.env.DEVHOST_DEMO_QUALITY ?? "delivery",
      // Lossless source frames keep the recorded interface text sharp.
      "--video-frame-format",
      "png",
      "--frames-cache-dir",
      join(temporaryPath, "promo-frames"),
      // The committed composition lints clean, so any new finding stops the render.
      "--strict-all",
    ],
    {
      cwd: projectPath,
      // A relative path keeps Chrome's profile sockets within Linux's 108-byte limit in deep worktrees.
      env: createPromoRendererEnvironment(process.env, relative(projectPath, temporaryPath)),
      signal,
      timeoutMs: 30 * 60_000,
      logPath: join(dirname(outputPath), "promo-render.log"),
    },
  );
}
