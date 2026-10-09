import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function findPromoRecording(parentPath: string, sourceIds: readonly string[]): Promise<string> {
  let latestPath = "";
  let latestModified = 0;
  for (const name of await readdir(parentPath).catch((): string[] => [])) {
    if (!name.startsWith("recording-")) continue;
    const path = join(parentPath, name);
    const recorded = (await readdir(join(path, "raw")).catch((): string[] => [])).map((file) =>
      file.replace(/\.[^.]+$/, ""),
    );
    // A single-scene run and a run that failed part-way hold only some of the recordings.
    if (!sourceIds.every((sourceId) => recorded.includes(sourceId))) continue;
    const modified = (await stat(path)).mtimeMs;
    if (modified > latestModified) {
      latestPath = path;
      latestModified = modified;
    }
  }
  if (latestPath === "") {
    throw new Error(
      `No recording holds the footage the promo requests (${sourceIds.join(", ")}); run \`just demo record\` first`,
    );
  }
  return latestPath;
}
