import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import type { IManagedCaddyPaths } from "./caddyPaths";
import { managedCaddyPaths } from "./caddyPaths";
import { renderManagedCaddyfile } from "./renderManagedCaddyfile";
import { syncManagedCaddyNotFoundSite } from "./syncManagedCaddyNotFoundSite";

export async function ensureManagedCaddyConfig(paths: IManagedCaddyPaths = managedCaddyPaths): Promise<void> {
  await mkdir(paths.caddyDirectoryPath, { recursive: true });
  await mkdir(paths.routesDirectoryPath, { recursive: true });
  await mkdir(paths.hostClaimsDirectoryPath, { recursive: true });
  await mkdir(paths.portClaimsDirectoryPath, { recursive: true });
  await mkdir(paths.registrationsDirectoryPath, { recursive: true });
  await mkdir(paths.storageDirectoryPath, { recursive: true });
  await syncManagedCaddyNotFoundSite(paths.routesDirectoryPath);
  await writeFile(
    paths.caddyfilePath,
    renderManagedCaddyfile(paths, process.platform, await readManagedHttpEnabled(paths)),
    "utf8",
  );
}

async function readManagedHttpEnabled(paths: IManagedCaddyPaths): Promise<boolean> {
  const registrationFileNames: string[] = await readdir(paths.registrationsDirectoryPath);

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = `${paths.registrationsDirectoryPath}/${registrationFileName}`;
    const registrationValue: unknown = JSON.parse(await readFile(registrationPath, "utf8"));

    if (
      typeof registrationValue === "object" &&
      registrationValue !== null &&
      Reflect.get(registrationValue, "httpEnabled") === true
    ) {
      return true;
    }
  }

  return false;
}
