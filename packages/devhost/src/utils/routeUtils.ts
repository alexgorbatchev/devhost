import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { caddyAdminApiUrl } from "../caddy/caddyPaths";
import { createManagedCaddyCommandErrorMessage, runManagedCaddyCommand } from "../caddy/runManagedCaddyCommand";
import { syncManagedCaddyNotFoundSite } from "../caddy/syncManagedCaddyNotFoundSite";
import { caddyAdminTimeoutInMilliseconds } from "./constants";
import { formatProxyAddress, resolveProxyHost } from "./resolveProxyHost";

interface IHostClaim {
  createdAt: string;
  host: string;
  manifestPath: string;
  ownerPid: number;
}

interface IRouteRegistration {
  appBindHost: string;
  appPort: number;
  createdAt: string;
  devtoolsControlPort?: number;
  documentInjectionPort?: number;
  host: string;
  manifestPath: string;
  ownerPid: number;
  path: string;
  serviceName: string;
}

interface ILegacyRouteRegistration {
  createdAt: string;
  host: string;
  ownerPid: number;
  path?: string;
  port: number;
}

type ManagedRouteRegistration = IRouteRegistration | ILegacyRouteRegistration;

export interface IActivateRouteOptions {
  appBindHost: string;
  appPort: number;
  devtoolsControlPort?: number;
  documentInjectionPort?: number;
  host: string;
  path: string;
  serviceName: string;
}

export interface IClaimHostOptions {
  host: string;
  manifestPath: string;
  registrationsDirectoryPath: string;
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
  const routesDirectoryPath: string = getRoutesDirectoryPath(registrationsDirectoryPath);
  const affectedHosts: Set<string> = new Set<string>();

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = join(registrationsDirectoryPath, registrationFileName);
    const registration: ManagedRouteRegistration = parseManagedRouteRegistration(await readFile(registrationPath, "utf8"));

    if (isProcessAlive(registration.ownerPid)) {
      continue;
    }

    affectedHosts.add(registration.host);
    await rm(registrationPath, { force: true });

    if (isLegacyRouteRegistration(registration)) {
      await rm(join(routesDirectoryPath, registrationFileName.replace(/\.json$/, ".caddy")), { force: true });
    }
  }

  await cleanupStaleHostClaims(getHostClaimsDirectoryPath(registrationsDirectoryPath));

  for (const host of affectedHosts) {
    await syncHostRoute(host, routesDirectoryPath);
  }

  if (affectedHosts.size > 0) {
    await syncManagedCaddyNotFoundSite(routesDirectoryPath);
  }
}

export async function claimHost(options: IClaimHostOptions): Promise<void> {
  await assertHostIsAvailable(options);

  const hostClaimPath: string = getHostClaimPath(options.host, options.registrationsDirectoryPath);
  const claimText: string = createHostClaimText(options.host, options.manifestPath);

  try {
    await writeFile(hostClaimPath, claimText, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error: unknown) {
    if (!isErrorWithCode(error) || error.code !== "EEXIST") {
      throw error;
    }

    const existingClaim: IHostClaim = parseHostClaim(await readFile(hostClaimPath, "utf8"));

    if (isHostClaimStale(existingClaim)) {
      await rm(hostClaimPath, { force: true });
      await writeFile(hostClaimPath, claimText, {
        encoding: "utf8",
        flag: "wx",
      });
      return;
    }

    if (existingClaim.ownerPid === process.pid && existingClaim.manifestPath === options.manifestPath) {
      return;
    }

    throw new Error(
      `${options.host} is already claimed by PID ${existingClaim.ownerPid} from ${existingClaim.manifestPath}.`,
    );
  }
}

export async function releaseHostClaim(options: IClaimHostOptions): Promise<void> {
  const claimPath: string = getHostClaimPath(options.host, options.registrationsDirectoryPath);

  try {
    const claim: IHostClaim = parseHostClaim(await readFile(claimPath, "utf8"));

    if (claim.ownerPid !== process.pid || claim.manifestPath !== options.manifestPath) {
      return;
    }
  } catch (error) {
    if (isErrorWithCode(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  await rm(claimPath, { force: true });
}

export async function activateRoute(
  options: IActivateRouteOptions,
  manifestPath: string,
  routesDirectoryPath: string,
): Promise<void> {
  const routeRegistrationPath: string = getRouteRegistrationPath(
    options.serviceName,
    options.host,
    options.path,
    routesDirectoryPath,
  );

  try {
    await writeFile(routeRegistrationPath, createRouteRegistrationText(options, manifestPath), "utf8");
    await syncHostRoute(options.host, routesDirectoryPath);
    await syncManagedCaddyNotFoundSite(routesDirectoryPath);
    reloadCaddy();
  } catch (error) {
    await rm(routeRegistrationPath, { force: true });
    await syncHostRoute(options.host, routesDirectoryPath);
    await syncManagedCaddyNotFoundSite(routesDirectoryPath);
    throw error;
  }
}

export async function unregisterRoute(
  serviceName: string,
  host: string,
  path: string,
  manifestPath: string,
  registrationsDirectoryPath: string,
): Promise<void> {
  const registrationPath: string = getRouteRegistrationPath(
    serviceName,
    host,
    path,
    getRoutesDirectoryPath(registrationsDirectoryPath),
  );
  const routesDirectoryPath: string = getRoutesDirectoryPath(registrationsDirectoryPath);

  try {
    const registration: IRouteRegistration = parseRouteRegistration(await readFile(registrationPath, "utf8"));

    if (registration.ownerPid !== process.pid || registration.manifestPath !== manifestPath) {
      return;
    }
  } catch {
    return;
  }

  await rm(registrationPath, { force: true });
  await syncHostRoute(host, routesDirectoryPath);
  await syncManagedCaddyNotFoundSite(routesDirectoryPath);
  reloadCaddy();
}

export function createRouteRegistrationText(options: IActivateRouteOptions, manifestPath: string): string {
  const registration: IRouteRegistration = {
    appBindHost: options.appBindHost,
    appPort: options.appPort,
    createdAt: new Date().toISOString(),
    host: options.host,
    manifestPath,
    ownerPid: process.pid,
    path: normalizeRoutePath(options.path),
    serviceName: options.serviceName,
  };

  if (options.devtoolsControlPort !== undefined) {
    registration.devtoolsControlPort = options.devtoolsControlPort;
  }

  if (options.documentInjectionPort !== undefined) {
    registration.documentInjectionPort = options.documentInjectionPort;
  }

  return JSON.stringify(registration, null, 2);
}

function getHostClaimPath(host: string, registrationsDirectoryPath: string): string {
  return join(getHostClaimsDirectoryPath(registrationsDirectoryPath), `${encodePathSegment(host)}.json`);
}

function getHostClaimsDirectoryPath(registrationsDirectoryPath: string): string {
  return join(getRoutesDirectoryPath(registrationsDirectoryPath), ".host-claims");
}

function getRouteRegistrationPath(serviceName: string, host: string, path: string, routesDirectoryPath: string): string {
  return join(
    getRegistrationsDirectoryPath(routesDirectoryPath),
    `${encodePathSegment(host)}_${serviceName}_${encodeRoutePathSegment(normalizeRoutePath(path))}.json`,
  );
}

function getHostRoutePath(host: string, routesDirectoryPath: string): string {
  return join(routesDirectoryPath, `${encodePathSegment(host)}.caddy`);
}

function getRegistrationsDirectoryPath(routesDirectoryPath: string): string {
  return join(routesDirectoryPath, ".registrations");
}

function getRoutesDirectoryPath(registrationsDirectoryPath: string): string {
  return join(registrationsDirectoryPath, "..");
}

function encodePathSegment(value: string): string {
  return value.replaceAll(":", "_");
}

function encodeRoutePathSegment(path: string): string {
  return Buffer.from(path).toString("hex");
}

function createHostClaimText(host: string, manifestPath: string): string {
  const hostClaim: IHostClaim = {
    createdAt: new Date().toISOString(),
    host,
    manifestPath,
    ownerPid: process.pid,
  };

  return JSON.stringify(hostClaim, null, 2);
}

async function assertHostIsAvailable(options: IClaimHostOptions): Promise<void> {
  const registrationFileNames: string[] = await readdir(options.registrationsDirectoryPath);

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = join(options.registrationsDirectoryPath, registrationFileName);
    const registration: ManagedRouteRegistration = parseManagedRouteRegistration(await readFile(registrationPath, "utf8"));

    if (registration.host !== options.host || !isProcessAlive(registration.ownerPid)) {
      continue;
    }

    if (!isLegacyRouteRegistration(registration)) {
      if (registration.ownerPid === process.pid && registration.manifestPath === options.manifestPath) {
        continue;
      }

      throw new Error(
        `${options.host} is already claimed by PID ${registration.ownerPid} from ${registration.manifestPath}.`,
      );
    }

    throw new Error(`${options.host} is already claimed by PID ${registration.ownerPid} on port ${registration.port}.`);
  }
}

async function cleanupStaleHostClaims(hostClaimsDirectoryPath: string): Promise<void> {
  const hostClaimFileNames: string[] = await readdir(hostClaimsDirectoryPath);

  for (const hostClaimFileName of hostClaimFileNames) {
    if (!hostClaimFileName.endsWith(".json")) {
      continue;
    }

    const claimPath: string = join(hostClaimsDirectoryPath, hostClaimFileName);
    const claim: IHostClaim = parseHostClaim(await readFile(claimPath, "utf8"));

    if (!isHostClaimStale(claim)) {
      continue;
    }

    await rm(claimPath, { force: true });
  }
}

function isHostClaimStale(claim: IHostClaim): boolean {
  if (claim.ownerPid === process.pid) {
    return false;
  }

  return !isProcessAlive(claim.ownerPid);
}

async function syncHostRoute(host: string, routesDirectoryPath: string): Promise<void> {
  const registrations: IRouteRegistration[] = await readHostRegistrations(host, routesDirectoryPath);
  const hostRoutePath: string = getHostRoutePath(host, routesDirectoryPath);

  if (registrations.length === 0) {
    await rm(hostRoutePath, { force: true });
    return;
  }

  await writeFile(hostRoutePath, renderHostRouteSnippet(registrations), "utf8");
}

async function readHostRegistrations(host: string, routesDirectoryPath: string): Promise<IRouteRegistration[]> {
  const registrationsDirectoryPath: string = getRegistrationsDirectoryPath(routesDirectoryPath);
  const registrationFileNames: string[] = await readdir(registrationsDirectoryPath);
  const registrations: IRouteRegistration[] = [];

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = join(registrationsDirectoryPath, registrationFileName);
    const registration: ManagedRouteRegistration = parseManagedRouteRegistration(await readFile(registrationPath, "utf8"));

    if (registration.host !== host || isLegacyRouteRegistration(registration)) {
      continue;
    }

    registrations.push(registration);
  }

  return registrations.sort(compareRouteRegistrations);
}

function compareRouteRegistrations(left: IRouteRegistration, right: IRouteRegistration): number {
  const leftWeight: number = readRoutePriorityWeight(left.path);
  const rightWeight: number = readRoutePriorityWeight(right.path);

  if (leftWeight !== rightWeight) {
    return rightWeight - leftWeight;
  }

  return left.serviceName.localeCompare(right.serviceName);
}

function readRoutePriorityWeight(path: string): number {
  if (path === "/") {
    return -1;
  }

  const basePath: string = path.endsWith("/*") ? path.slice(0, -2) : path;
  const wildcardPenalty: number = path.endsWith("/*") ? 0 : 1;

  return basePath.length * 10 + wildcardPenalty;
}

function parseHostClaim(claimText: string): IHostClaim {
  const parsedValue: unknown = JSON.parse(claimText);

  if (!isHostClaim(parsedValue)) {
    throw new Error("Host claim is malformed.");
  }

  return parsedValue;
}

function parseManagedRouteRegistration(registrationText: string): ManagedRouteRegistration {
  const parsedValue: unknown = JSON.parse(registrationText);

  if (isRouteRegistration(parsedValue)) {
    return {
      ...parsedValue,
      path: normalizeRoutePath(parsedValue.path),
    };
  }

  if (isLegacyRouteRegistration(parsedValue)) {
    return {
      ...parsedValue,
      path: normalizeRoutePath(parsedValue.path ?? "/"),
    };
  }

  throw new Error("Registration file is malformed.");
}

function parseRouteRegistration(registrationText: string): IRouteRegistration {
  const registration: ManagedRouteRegistration = parseManagedRouteRegistration(registrationText);

  if (isLegacyRouteRegistration(registration)) {
    throw new Error("Registration file is malformed.");
  }

  return registration;
}

function isHostClaim(value: unknown): value is IHostClaim {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "createdAt") === "string" &&
    typeof Reflect.get(value, "host") === "string" &&
    typeof Reflect.get(value, "manifestPath") === "string" &&
    typeof Reflect.get(value, "ownerPid") === "number"
  );
}

function isRouteRegistration(value: unknown): value is IRouteRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "appBindHost") === "string" &&
    typeof Reflect.get(value, "appPort") === "number" &&
    typeof Reflect.get(value, "createdAt") === "string" &&
    (Reflect.get(value, "devtoolsControlPort") === undefined || typeof Reflect.get(value, "devtoolsControlPort") === "number") &&
    (Reflect.get(value, "documentInjectionPort") === undefined ||
      typeof Reflect.get(value, "documentInjectionPort") === "number") &&
    typeof Reflect.get(value, "host") === "string" &&
    typeof Reflect.get(value, "manifestPath") === "string" &&
    typeof Reflect.get(value, "ownerPid") === "number" &&
    typeof Reflect.get(value, "path") === "string" &&
    typeof Reflect.get(value, "serviceName") === "string"
  );
}

function isLegacyRouteRegistration(value: unknown): value is ILegacyRouteRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "createdAt") === "string" &&
    typeof Reflect.get(value, "host") === "string" &&
    typeof Reflect.get(value, "ownerPid") === "number" &&
    typeof Reflect.get(value, "port") === "number" &&
    (Reflect.get(value, "path") === undefined || typeof Reflect.get(value, "path") === "string")
  );
}

function normalizeRoutePath(path: string): string {
  if (path === "/" || path === "/*") {
    return "/";
  }

  return path;
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

function reloadCaddy(): void {
  const result = runManagedCaddyCommand(["reload"]);

  if (!result.success) {
    throw new Error(createCaddyReloadErrorMessage(result.stdout, result.stderr));
  }
}

export function renderHostRouteSnippet(registrations: IRouteRegistration[]): string {
  const host: string = registrations[0].host;
  const rootRegistration: IRouteRegistration | undefined = registrations.find(
    (registration: IRouteRegistration): boolean => registration.path === "/",
  );
  const nonRootRegistrations: IRouteRegistration[] = registrations.filter(
    (registration: IRouteRegistration): boolean => registration.path !== "/",
  );
  const lines: string[] = [`${host} {`, "    tls internal", ""];

  if (rootRegistration?.devtoolsControlPort !== undefined) {
    lines.push("    @devhost_control path /__devhost__/*");
    lines.push("    handle @devhost_control {");
    lines.push(`        reverse_proxy ${formatProxyAddress("127.0.0.1", rootRegistration.devtoolsControlPort)}`);
    lines.push("    }");
    lines.push("");
  }

  for (const registration of nonRootRegistrations) {
    lines.push(...renderServiceHandle(registration));
    lines.push("");
  }

  if (rootRegistration !== undefined) {
    if (
      rootRegistration.devtoolsControlPort !== undefined &&
      rootRegistration.documentInjectionPort !== undefined
    ) {
      lines.push("    @devhost_document header Sec-Fetch-Dest document");
      lines.push("    handle @devhost_document {");
      lines.push(
        `        reverse_proxy ${formatProxyAddress("127.0.0.1", rootRegistration.documentInjectionPort)}`,
      );
      lines.push("    }");
      lines.push("");
    }

    lines.push("    handle {");
    lines.push(`        reverse_proxy ${readAppTarget(rootRegistration)}`);
    lines.push("    }");
  } else {
    lines.push("    handle {");
    lines.push("        error 404");
    lines.push("    }");
  }

  lines.push("}\n");

  return lines.join("\n");
}

function renderServiceHandle(registration: IRouteRegistration): string[] {
  return [
    `    handle ${registration.path} {`,
    `        reverse_proxy ${readAppTarget(registration)}`,
    "    }",
  ];
}

function readAppTarget(registration: IRouteRegistration): string {
  return formatProxyAddress(resolveProxyHost(registration.appBindHost), registration.appPort);
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
