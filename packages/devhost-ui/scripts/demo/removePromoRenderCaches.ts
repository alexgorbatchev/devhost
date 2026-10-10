import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { RemovePromoCache } from "./types";

const removeTree: RemovePromoCache = (path) => rm(path, { recursive: true, force: true });

export async function removePromoRenderCaches(
  temporaryPath: string,
  remove: RemovePromoCache = removeTree,
): Promise<void> {
  const installs = await Array.fromAsync(
    new Bun.Glob("bunx-*-hyperframes@*").scan({ cwd: temporaryPath, onlyFiles: false }),
  ).catch((): string[] => []);
  // The extracted source frames and the HyperFrames install are several hundred megabytes that only a render reads.
  const caches = ["promo-frames", ...installs].map((name) => join(temporaryPath, name));
  // A cache that cannot be removed does not keep the others on disk.
  const results = await Promise.allSettled(caches.map((cache) => remove(cache)));
  const errors: unknown[] = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 0) throw new AggregateError(errors, `Could not remove every render cache under ${temporaryPath}`);
}
