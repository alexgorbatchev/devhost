import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { planPromoFootage } from "./planPromoFootage";
import { readMediaInfo } from "./readMediaInfo";
import { readPromoFootageSlots } from "./readPromoFootageSlots";
import { runCommand } from "./runCommand";
import type { IStagedPromoFootage, PromoFootageSource } from "./types";

export async function stagePromoFootage(
  projectPath: string,
  sources: readonly PromoFootageSource[],
  signal: AbortSignal,
): Promise<IStagedPromoFootage[]> {
  const files = await Array.fromAsync(new Bun.Glob("**/*.html").scan({ cwd: projectPath, onlyFiles: true }));
  await mkdir(join(projectPath, "assets/footage"), { recursive: true });
  const staged: IStagedPromoFootage[] = [];
  for (const file of files.sort()) {
    for (const slot of await readPromoFootageSlots(await Bun.file(join(projectPath, file)).text())) {
      const source = sources.find((candidate) => candidate.id === slot.sourceId);
      if (!source) throw new Error(`${file} requests footage ${slot.sourceId}, which this run did not record`);
      const plan = planPromoFootage(slot, (await readMediaInfo(source.path)).duration);
      const outputPath = join(projectPath, slot.outputPath);
      const filters = [`setpts=PTS/${plan.speed}`, "fps=30", "scale=trunc(iw/2)*2:trunc(ih/2)*2"];
      // The final -t cuts the padded hold back to the slot length.
      if (plan.holdSeconds > 0) filters.push(`tpad=stop_mode=clone:stop_duration=${plan.holdSeconds + 1}`);
      await runCommand(
        [
          "ffmpeg",
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          String(plan.startSeconds),
          "-t",
          String(plan.sourceSeconds),
          "-i",
          source.path,
          "-vf",
          filters.join(","),
          "-t",
          String(slot.duration),
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "16",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          outputPath,
        ],
        { signal },
      );
      const output = await readMediaInfo(outputPath);
      assert(
        Math.abs(output.duration - slot.duration) < 0.1,
        `Staged footage ${slot.id} lasts ${output.duration}s instead of ${slot.duration}s`,
      );
      staged.push({ ...slot, ...plan });
    }
  }
  return staged;
}
