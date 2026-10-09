import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
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
      env: {
        ...process.env,
        // The render neither installs agent skills on this machine nor reports usage.
        HYPERFRAMES_SKIP_SKILLS: "1",
        HYPERFRAMES_NO_TELEMETRY: "1",
        // A relative path keeps Chrome's profile sockets within Linux's 108-byte limit in deep worktrees.
        TMPDIR: relative(projectPath, temporaryPath),
      },
      signal,
      timeoutMs: 30 * 60_000,
      logPath: join(dirname(outputPath), "promo-render.log"),
    },
  );
}
