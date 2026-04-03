import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { caddyAdminApiUrl } from "./caddyPaths";
import { caddyAdminTimeoutInMilliseconds } from "./constants";
import { formatProxyAddress, resolveProxyHost } from "./resolveProxyHost";
import { createManagedCaddyCommandErrorMessage, runManagedCaddyCommand } from "./runManagedCaddyCommand";

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

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export async function ensureCaddyAdminAvailable(fetchImplementation: FetchImplementation = fetch): Promise<void> {
  try {
    const response: Response = await fetchImplementation(caddyAdminApiUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(caddyAdminTimeoutInMilliseconds),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
  } catch (error: unknown) {
    const detail: string = error instanceof Error ? error.message : String(error);

    throw new Error(createCaddyAdminUnavailableErrorMessage(detail));
  }
}

export async function cleanupStaleRegistrations(registrationsDirectoryPath: string): Promise<void> {
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

    await removeRouteFiles(
      registration.host,
      registrationsDirectoryPath,
      getRoutesDirectoryPath(registrationsDirectoryPath),
    );
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

export async function claimRegistration(host: string, port: number, registrationsDirectoryPath: string): Promise<void> {
  const registrationPath: string = getRegistrationPath(host, registrationsDirectoryPath);
  const registrationText: string = createRegistration(host, port);
  const routesDirectoryPath: string = getRoutesDirectoryPath(registrationsDirectoryPath);

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

    await removeRouteFiles(existingRegistration.host, registrationsDirectoryPath, routesDirectoryPath);
    await writeFile(registrationPath, registrationText, {
      encoding: "utf8",
      flag: "wx",
    });
  }
}

export async function activateRoute(options: IActivateRouteOptions, routesDirectoryPath: string): Promise<void> {
  const routePath: string = getRoutePath(options.host, routesDirectoryPath);
  const registrationsDirectoryPath: string = getRegistrationsDirectoryPath(routesDirectoryPath);

  try {
    await writeFile(routePath, renderRouteSnippet(options), "utf8");
    reloadCaddy();
  } catch (error) {
    await removeRouteFiles(options.host, registrationsDirectoryPath, routesDirectoryPath);
    throw error;
  }
}

export async function unregisterRoute(host: string, registrationsDirectoryPath: string): Promise<void> {
  const registrationPath: string = getRegistrationPath(host, registrationsDirectoryPath);
  const routesDirectoryPath: string = getRoutesDirectoryPath(registrationsDirectoryPath);

  try {
    const registrationText: string = await readFile(registrationPath, "utf8");
    const registration: IRegistration = parseRegistration(registrationText);

    if (registration.ownerPid !== process.pid) {
      return;
    }
  } catch {
    return;
  }

  await removeRouteFiles(host, registrationsDirectoryPath, routesDirectoryPath);
  reloadCaddy();
}

export async function removeRouteFiles(
  host: string,
  registrationsDirectoryPath: string,
  routesDirectoryPath: string,
): Promise<void> {
  await rm(getRegistrationPath(host, registrationsDirectoryPath), { force: true });
  await rm(getRoutePath(host, routesDirectoryPath), { force: true });
}

function getRegistrationPath(host: string, registrationsDirectoryPath: string): string {
  return join(registrationsDirectoryPath, `${host}.json`);
}

function getRoutePath(host: string, routesDirectoryPath: string): string {
  return join(routesDirectoryPath, `${host}.caddy`);
}

function getRegistrationsDirectoryPath(routesDirectoryPath: string): string {
  return join(routesDirectoryPath, ".registrations");
}

function getRoutesDirectoryPath(registrationsDirectoryPath: string): string {
  return join(registrationsDirectoryPath, "..");
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

type ErrorWithCode = Error & { code: string };

function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return error instanceof Error && typeof Reflect.get(error, "code") === "string";
}

function parseRegistration(registrationText: string): IRegistration {
  const parsedValue: unknown = JSON.parse(registrationText);

  if (typeof parsedValue !== "object" || parsedValue === null) {
    throw new Error("Registration file is malformed.");
  }

  // New interface for raw parsed registration
  interface IRawRegistration {
    host: unknown;
    port: unknown;
    ownerPid: unknown;
    createdAt: unknown;
  }

  function isRawRegistration(value: unknown): value is IRawRegistration {
    return (
      typeof value === "object" &&
      value !== null &&
      "host" in value &&
      "port" in value &&
      "ownerPid" in value &&
      "createdAt" in value
    );
  }

  if (!isRawRegistration(parsedValue)) {
    throw new Error("Registration file is malformed.");
  }

  const { host, port, ownerPid, createdAt } = parsedValue;

  if (
    typeof host !== "string" ||
    typeof port !== "number" ||
    typeof ownerPid !== "number" ||
    typeof createdAt !== "string"
  ) {
    throw new Error("Registration file is malformed.");
  }

  return {
    host,
    port,
    ownerPid,
    createdAt,
  };
}

function reloadCaddy(): void {
  const result = runManagedCaddyCommand(["reload"]);

  if (!result.success) {
    throw new Error(createCaddyReloadErrorMessage(result.stdout, result.stderr));
  }
}

export function createCaddyAdminUnavailableErrorMessage(detail: string | null): string {
  const baseMessage: string = "Caddy admin API is not available. Run 'devhost caddy start' first.";
  const normalizedDetail: string | null = normalizeCaddyAdminErrorDetail(detail);

  if (normalizedDetail === null) {
    return baseMessage;
  }

  return `${baseMessage}\ndetail: ${normalizedDetail}`;
}

function normalizeCaddyAdminErrorDetail(detail: string | null): string | null {
  if (detail === null) {
    return null;
  }

  const trimmedDetail: string = detail.trim().replace(" Is the computer able to access the url?", "");

  if (trimmedDetail.length === 0) {
    return null;
  }

  return trimmedDetail;
}

export function createCaddyReloadErrorMessage(stdout: Uint8Array, stderr: Uint8Array): string {
  const baseMessage: string = "Caddy reload failed. Is Caddy already running?";
  const renderedMessage: string = createManagedCaddyCommandErrorMessage("reload", {
    stderr,
    stdout,
    success: false,
  });

  if (renderedMessage === "Caddy reload failed.") {
    return baseMessage;
  }

  const detail: string = renderedMessage.replace("Caddy reload failed.\n", "");

  return `${baseMessage}\n${detail}`;
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
