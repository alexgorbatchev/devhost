import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import type { IManagedCaddyPaths } from "./caddyPaths";
import { managedCaddyPaths } from "./caddyPaths";
import { defaultManagedCaddyBindHost } from "./resolveManagedCaddyBindDirective";
import { renderManagedCaddyfile } from "./renderManagedCaddyfile";
import { syncManagedCaddyNotFoundSite } from "./syncManagedCaddyNotFoundSite";

interface IManagedCaddyGlobalSettings {
  bindHost: string;
  httpEnabled: boolean;
}

export async function ensureManagedCaddyConfig(paths: IManagedCaddyPaths = managedCaddyPaths): Promise<void> {
  await mkdir(paths.caddyDirectoryPath, { recursive: true });
  await mkdir(paths.routesDirectoryPath, { recursive: true });
  await mkdir(paths.hostClaimsDirectoryPath, { recursive: true });
  await mkdir(paths.portClaimsDirectoryPath, { recursive: true });
  await mkdir(paths.registrationsDirectoryPath, { recursive: true });
  await mkdir(paths.storageDirectoryPath, { recursive: true });
  await syncManagedCaddyNotFoundSite(paths.routesDirectoryPath);
  const globalSettings: IManagedCaddyGlobalSettings = await readManagedCaddyGlobalSettings(paths);

  await writeFile(
    paths.caddyfilePath,
    renderManagedCaddyfile(paths, process.platform, globalSettings.httpEnabled, globalSettings.bindHost),
    "utf8",
  );
}

async function readManagedCaddyGlobalSettings(paths: IManagedCaddyPaths): Promise<IManagedCaddyGlobalSettings> {
  const registrationFileNames: string[] = await readdir(paths.registrationsDirectoryPath);
  let httpEnabled: boolean = false;
  const optedInBindHosts: Set<string> = new Set<string>();

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = `${paths.registrationsDirectoryPath}/${registrationFileName}`;
    const registrationValue: unknown = JSON.parse(await readFile(registrationPath, "utf8"));

    if (
      typeof registrationValue !== "object" ||
      registrationValue === null ||
      typeof Reflect.get(registrationValue, "appBindHost") !== "string"
    ) {
      continue;
    }

    if (Reflect.get(registrationValue, "httpEnabled") === true) {
      httpEnabled = true;
    }

    const caddyBindHost: unknown = Reflect.get(registrationValue, "caddyBindHost");

    if (typeof caddyBindHost === "string") {
      optedInBindHosts.add(caddyBindHost);
    }
  }

  if (optedInBindHosts.size > 1) {
    throw new Error(
      `Managed Caddy bind host is inconsistent across active stacks: ${Array.from(optedInBindHosts).sort().join(", ")}.`,
    );
  }

  return {
    bindHost: optedInBindHosts.values().next().value ?? defaultManagedCaddyBindHost,
    httpEnabled,
  };
}
