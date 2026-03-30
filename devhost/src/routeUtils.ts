import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { caddyDirectoryPath, caddyfilePath, registrationsDirectoryPath, routesDirectoryPath } from "./constants";
import { formatProxyAddress, resolveProxyHost } from "./resolveProxyHost";

interface IRegistration {
  host: string;
  port: number;
  ownerPid: number;
  createdAt: string;
}

interface IActivateRouteOptions {
  host: string;
  appBindHost: string;
  appPort: number;
  devtoolsControlPort?: number;
  documentInjectionPort?: number;
}

export async function ensureRouteDirectories(): Promise<void> {
  await mkdir(registrationsDirectoryPath, { recursive: true });
}

export async function ensureCaddyfileExists(): Promise<void> {
  try {
    await access(caddyfilePath);
  } catch {
    throw new Error(`Required file is missing: ${caddyfilePath}`);
  }
}

export async function cleanupStaleRegistrations(): Promise<void> {
  const registrationFileNames: string[] = await readdir(registrationsDirectoryPath);

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = join(registrationsDirectoryPath, registrationFileName);
    const registrationText: string = await readFile(registrationPath, "utf8");
    const registration: IRegistration = parseRegistration(registrationText);

    if (isProcessAlive(registration.ownerPid)) {
      continue;
    }

    await removeRouteFiles(registration.host);
  }
}

export function createRegistration(host: string, port: number): string {
  const registration: IRegistration = {
    host,
    port,
    ownerPid: process.pid,
    createdAt: new Date().toISOString(),
  };

  return JSON.stringify(registration, null, 2);
}

export async function claimRegistration(host: string, port: number): Promise<void> {
  const registrationPath: string = getRegistrationPath(host);
  const registrationText: string = createRegistration(host, port);

  try {
    await writeFile(registrationPath, registrationText, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error: unknown) {
    if (!isErrorWithCode(error) || error.code !== "EEXIST") {
      throw error;
    }

    const existingText: string = await readFile(registrationPath, "utf8");
    const existingRegistration: IRegistration = parseRegistration(existingText);

    if (isProcessAlive(existingRegistration.ownerPid)) {
      throw new Error(
        `${host} is already claimed by PID ${existingRegistration.ownerPid} on port ${existingRegistration.port}.`,
      );
    }

    await removeRouteFiles(existingRegistration.host);
    await writeFile(registrationPath, registrationText, {
      encoding: "utf8",
      flag: "wx",
    });
  }
}

export async function activateRoute(options: IActivateRouteOptions): Promise<void> {
  const routePath: string = getRoutePath(options.host);

  try {
    await writeFile(routePath, renderRouteSnippet(options), "utf8");
    reloadCaddy();
  } catch (error) {
    await removeRouteFiles(options.host);
    throw error;
  }
}

export async function unregisterRoute(host: string): Promise<void> {
  const registrationPath: string = getRegistrationPath(host);

  try {
    const registrationText: string = await readFile(registrationPath, "utf8");
    const registration: IRegistration = parseRegistration(registrationText);

    if (registration.ownerPid !== process.pid) {
      return;
    }
  } catch {
    return;
  }

  await removeRouteFiles(host);
  reloadCaddy();
}

export async function removeRouteFiles(host: string): Promise<void> {
  await rm(getRegistrationPath(host), { force: true });
  await rm(getRoutePath(host), { force: true });
}

function getRegistrationPath(host: string): string {
  return join(registrationsDirectoryPath, `${host}.json`);
}

function getRoutePath(host: string): string {
  return join(routesDirectoryPath, `${host}.caddy`);
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof Reflect.get(error, "code") === "string";
}

function parseRegistration(registrationText: string): IRegistration {
  const parsedValue: unknown = JSON.parse(registrationText);

  if (
    typeof parsedValue !== "object" ||
    parsedValue === null ||
    typeof Reflect.get(parsedValue, "host") !== "string" ||
    typeof Reflect.get(parsedValue, "port") !== "number" ||
    typeof Reflect.get(parsedValue, "ownerPid") !== "number" ||
    typeof Reflect.get(parsedValue, "createdAt") !== "string"
  ) {
    throw new Error("Registration file is malformed.");
  }

  return parsedValue;
}

function reloadCaddy(): void {
  const result = Bun.spawnSync(["caddy", "reload", "--config", caddyfilePath, "--adapter", "caddyfile"], {
    cwd: caddyDirectoryPath,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!result.success) {
    throw new Error("Caddy reload failed. Is Caddy already running?");
  }
}

function renderRouteSnippet(options: IActivateRouteOptions): string {
  const proxyHost: string = resolveProxyHost(options.appBindHost);
  const appTarget: string = formatProxyAddress(proxyHost, options.appPort);

  if (options.devtoolsControlPort === undefined || options.documentInjectionPort === undefined) {
    return [`${options.host} {`, "    tls internal", `    reverse_proxy ${appTarget}`, "}", ""].join("\n");
  }

  return [
    `${options.host} {`,
    "    tls internal",
    "",
    "    @devhost_control path /__devhost__/*",
    "    handle @devhost_control {",
    `        reverse_proxy ${formatProxyAddress("127.0.0.1", options.devtoolsControlPort)}`,
    "    }",
    "",
    "    @devhost_document header Sec-Fetch-Dest document",
    "    handle @devhost_document {",
    `        reverse_proxy ${formatProxyAddress("127.0.0.1", options.documentInjectionPort)}`,
    "    }",
    "",
    "    handle {",
    `        reverse_proxy ${appTarget}`,
    "    }",
    "}",
    "",
  ].join("\n");
}
