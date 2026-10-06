import { z } from "zod";
import { resolve } from "node:path";
import type { INativeReactProvisioning } from "./types";

const provisioningSchema = z.strictObject({
  chromeArchivePath: z.string().min(1),
  reactCrxPath: z.string().min(1),
  caddyExecutablePath: z.string().min(1),
  devhostExecutablePath: z.string().min(1),
});

export async function readNativeReactProvisioning(path: string | undefined): Promise<INativeReactProvisioning> {
  if (path === undefined || path.length === 0)
    throw new Error(
      "Set DEVHOST_NATIVE_REACT_ASSETS to the provisioned asset JSON path. Missing assets fail acceptance.",
    );
  const input: unknown = await Bun.file(resolve(path)).json();
  const configuration = provisioningSchema.parse(input);
  return {
    chromeArchivePath: resolve(configuration.chromeArchivePath),
    reactCrxPath: resolve(configuration.reactCrxPath),
    caddyExecutablePath: resolve(configuration.caddyExecutablePath),
    devhostExecutablePath: resolve(configuration.devhostExecutablePath),
  };
}
