import { mkdir, writeFile } from "node:fs/promises";

import type { IManagedCaddyPaths } from "./caddyPaths";
import { managedCaddyPaths } from "./caddyPaths";
import { renderManagedCaddyfile } from "./renderManagedCaddyfile";

export async function ensureManagedCaddyConfig(paths: IManagedCaddyPaths = managedCaddyPaths): Promise<void> {
  await mkdir(paths.caddyDirectoryPath, { recursive: true });
  await mkdir(paths.routesDirectoryPath, { recursive: true });
  await mkdir(paths.registrationsDirectoryPath, { recursive: true });
  await mkdir(paths.storageDirectoryPath, { recursive: true });
  await writeFile(paths.caddyfilePath, renderManagedCaddyfile(paths), "utf8");
}
