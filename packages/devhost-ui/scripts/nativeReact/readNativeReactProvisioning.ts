import { resolve } from "node:path";
import type { INativeReactProvisioning } from "./types";

// Finds the executables the acceptance runs: Caddy on PATH and the devhost binary `just devhost compile` builds.
export async function readNativeReactProvisioning(repositoryRoot: string): Promise<INativeReactProvisioning> {
  const caddyExecutablePath = Bun.which("caddy");
  if (caddyExecutablePath === null) throw new Error("Native React acceptance needs caddy on PATH.");
  const devhostExecutablePath = resolve(repositoryRoot, "apps/devhost/bin/devhost");
  if (!(await Bun.file(devhostExecutablePath).exists())) {
    throw new Error(`Run \`just devhost compile\` first: ${devhostExecutablePath} is missing.`);
  }
  return { caddyExecutablePath, devhostExecutablePath };
}
