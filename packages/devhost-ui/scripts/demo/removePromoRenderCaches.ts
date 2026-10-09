import { rm } from "node:fs/promises";
import { join } from "node:path";

export async function removePromoRenderCaches(temporaryPath: string): Promise<void> {
  // The extracted source frames and the HyperFrames install are several hundred megabytes that only a render reads.
  await rm(join(temporaryPath, "promo-frames"), { recursive: true, force: true });
  const installs = await Array.fromAsync(
    new Bun.Glob("bunx-*-hyperframes@*").scan({ cwd: temporaryPath, onlyFiles: false }),
  ).catch((): string[] => []);
  for (const install of installs) await rm(join(temporaryPath, install), { recursive: true, force: true });
}
