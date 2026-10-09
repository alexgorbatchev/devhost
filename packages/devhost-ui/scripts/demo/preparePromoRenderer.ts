import { promoMinimumNodeMajor } from "./constants";
import { createPromoRendererEnvironment } from "./createPromoRendererEnvironment";
import type { RunCommand } from "./types";

export async function preparePromoRenderer(
  run: RunCommand,
  projectPath: string,
  temporaryPath: string,
  signal: AbortSignal,
): Promise<void> {
  const version = (await run(["node", "--version"], { signal })).trim();
  const major = Number(/^v(\d+)\./.exec(version)?.[1]);
  if (!Number.isInteger(major)) throw new Error(`Cannot read the Node.js version from: ${version}`);
  if (major < promoMinimumNodeMajor) {
    throw new Error(`The promo's renderer needs Node.js ${promoMinimumNodeMajor} or newer; found ${version}`);
  }
  // HyperFrames renders with its own Chrome build; the first run downloads it, later runs find it.
  await run(["bun", "run", "browser"], {
    cwd: projectPath,
    env: createPromoRendererEnvironment(process.env, temporaryPath),
    signal,
    timeoutMs: 10 * 60_000,
  });
}
