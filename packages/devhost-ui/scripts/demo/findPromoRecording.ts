import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readPromoSources } from "./readPromoSources";

export async function findPromoRecording(parentPath: string, sourceIds: readonly string[]): Promise<string> {
  let latestPath = "";
  let latestModified = 0;
  for (const name of await readdir(parentPath).catch((): string[] => [])) {
    if (!name.startsWith("recording-")) continue;
    const path = join(parentPath, name);
    // A recording the promo could not render from, for any reason, is not a candidate.
    const recorded = (await readPromoSources(path).catch(() => [])).map((source) => source.id);
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
