import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import type { IManagedCaddyPaths } from "./caddyPaths";
import { managedCaddyPaths } from "./caddyPaths";
import { defaultManagedCaddyHttpPort, defaultManagedCaddyHttpsPort } from "./managedCaddyPorts";
import { defaultManagedCaddyBindHost } from "./resolveManagedCaddyBindDirective";
import { renderManagedCaddyfile } from "./renderManagedCaddyfile";
import { syncManagedCaddyNotFoundSite } from "./syncManagedCaddyNotFoundSite";

interface IManagedCaddyGlobalSettings {
  bindHost: string;
  httpPort: number;
  httpEnabled: boolean;
  httpsPort: number;
}

export async function ensureManagedCaddyConfig(paths: IManagedCaddyPaths = managedCaddyPaths): Promise<void> {
  await mkdir(paths.caddyDirectoryPath, { recursive: true });
  await mkdir(paths.routesDirectoryPath, { recursive: true });
  await mkdir(paths.hostClaimsDirectoryPath, { recursive: true });
  await mkdir(paths.portClaimsDirectoryPath, { recursive: true });
  await mkdir(paths.registrationsDirectoryPath, { recursive: true });
  await mkdir(paths.storageDirectoryPath, { recursive: true });
  const globalSettings: IManagedCaddyGlobalSettings = await readManagedCaddyGlobalSettings(paths);

  await syncManagedCaddyNotFoundSite(paths.routesDirectoryPath, globalSettings.httpsPort);

  await writeFile(
    paths.caddyfilePath,
    renderManagedCaddyfile({
      bindHost: globalSettings.bindHost,
      enableHttp: globalSettings.httpEnabled,
      httpPort: globalSettings.httpPort,
      httpsPort: globalSettings.httpsPort,
      paths,
      platform: process.platform,
    }),
    "utf8",
  );
}

async function readManagedCaddyGlobalSettings(paths: IManagedCaddyPaths): Promise<IManagedCaddyGlobalSettings> {
  const registrationFileNames: string[] = await readdir(paths.registrationsDirectoryPath);
  let httpEnabled: boolean = false;
  const optedInBindHosts: Set<string> = new Set<string>();
  const optedInHttpPorts: Set<number> = new Set<number>();
  const optedInHttpsPorts: Set<number> = new Set<number>();

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
    const caddyHttpPort: unknown = Reflect.get(registrationValue, "caddyHttpPort");
    const caddyHttpsPort: unknown = Reflect.get(registrationValue, "caddyHttpsPort");

    if (typeof caddyBindHost === "string") {
      optedInBindHosts.add(caddyBindHost);
    }

    if (typeof caddyHttpPort === "number") {
      optedInHttpPorts.add(caddyHttpPort);
    }

    if (typeof caddyHttpsPort === "number") {
      optedInHttpsPorts.add(caddyHttpsPort);
    }
  }

  if (optedInBindHosts.size > 1) {
    throw new Error(
      `Managed Caddy bind host is inconsistent across active stacks: ${Array.from(optedInBindHosts).sort().join(", ")}.`,
    );
  }

  if (optedInHttpPorts.size > 1) {
    throw new Error(
      `Managed Caddy HTTP port is inconsistent across active stacks: ${Array.from(optedInHttpPorts)
        .sort((left, right) => left - right)
        .join(", ")}.`,
    );
  }

  if (optedInHttpsPorts.size > 1) {
    throw new Error(
      `Managed Caddy HTTPS port is inconsistent across active stacks: ${Array.from(optedInHttpsPorts)
        .sort((left, right) => left - right)
        .join(", ")}.`,
    );
  }

  return {
    bindHost: optedInBindHosts.values().next().value ?? defaultManagedCaddyBindHost,
    httpPort: optedInHttpPorts.values().next().value ?? defaultManagedCaddyHttpPort,
    httpEnabled,
    httpsPort: optedInHttpsPorts.values().next().value ?? defaultManagedCaddyHttpsPort,
  };
}
