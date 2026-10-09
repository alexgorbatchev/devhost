import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readPromoSources } from "./readPromoSources";
import type { PromoFootageSource } from "./types";

export async function findPromoRecording(parentPath: string, sourceIds: readonly string[]): Promise<string> {
  let latestPath = "";
  let latestCaptured = Number.NEGATIVE_INFINITY;
  for (const name of await readdir(parentPath).catch((): string[] => [])) {
    if (!name.startsWith("recording-")) continue;
    const path = join(parentPath, name);
    // A recording the promo could not render from, for any reason, is not a candidate.
    const sources = await readPromoSources(path).catch((): PromoFootageSource[] => []);
    const requested = sources.filter((source) => sourceIds.includes(source.id));
    // A single-scene run and a run that failed part-way hold only some of the recordings.
    if (!sourceIds.every((sourceId) => requested.some((source) => source.id === sourceId))) continue;
    // A later render rewrites the recording's directory, so its age is that of the footage the promo would use.
    const modified = await Promise.all(requested.map(async (source) => (await stat(source.path)).mtimeMs));
    const captured = Math.max(...modified);
    if (latestPath === "" || captured > latestCaptured) {
      latestPath = path;
      latestCaptured = captured;
    }
  }
  if (latestPath === "") {
    throw new Error(
      `No recording holds the footage the promo requests (${sourceIds.join(", ")}); run \`just demo record\` first`,
    );
  }
  return latestPath;
}
