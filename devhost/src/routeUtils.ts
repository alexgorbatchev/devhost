import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  caddyAdminApiUrl,
  caddyAdminTimeoutInMilliseconds,
  caddyDirectoryPath,
  caddyfilePath,
  registrationsDirectoryPath,
  routesDirectoryPath,
} from "./constants";
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

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

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

  if (typeof parsedValue !== "object" || parsedValue === null) {
    throw new Error("Registration file is malformed.");
  }

  const host: unknown = Reflect.get(parsedValue, "host");
  const port: unknown = Reflect.get(parsedValue, "port");
  const ownerPid: unknown = Reflect.get(parsedValue, "ownerPid");
  const createdAt: unknown = Reflect.get(parsedValue, "createdAt");

  if (typeof host !== "string" || typeof port !== "number" || typeof ownerPid !== "number" || typeof createdAt !== "string") {
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
  const result = Bun.spawnSync(["caddy", "reload", "--config", caddyfilePath, "--adapter", "caddyfile"], {
    cwd: caddyDirectoryPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    throw new Error(createCaddyReloadErrorMessage(result.stdout, result.stderr));
  }
}

export function createCaddyAdminUnavailableErrorMessage(detail: string | null): string {
  const baseMessage: string = "Caddy admin API is not available.";
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
  const stdoutText: string = decodeProcessOutput(stdout);
  const stderrText: string = decodeProcessOutput(stderr);
  const combinedOutput: string = [stderrText, stdoutText].filter((text: string): boolean => text.length > 0).join("\n");

  if (combinedOutput.length === 0) {
    return "Caddy reload failed. Is Caddy already running?";
  }

  return `Caddy reload failed. Is Caddy already running?\n${combinedOutput}`;
}

function decodeProcessOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
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
