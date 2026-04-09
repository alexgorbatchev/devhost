import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createManagedCaddyNotFoundSitePaths } from "./createManagedCaddyNotFoundSitePaths";
import { managedCaddyNotFoundPageCss } from "./managedCaddyNotFoundPageCss";
import { renderManagedCaddyNotFoundPage, type IManagedCaddyNotFoundRouteLink } from "./renderManagedCaddyNotFoundPage";

interface IManagedRouteRegistration {
  host: string;
  path: string;
}

interface ILegacyManagedRouteRegistration {
  host: string;
  path?: string;
}

export async function syncManagedCaddyNotFoundSite(routesDirectoryPath: string): Promise<void> {
  const caddyDirectoryPath: string = join(routesDirectoryPath, "..");
  const sitePaths = createManagedCaddyNotFoundSitePaths(caddyDirectoryPath);
  const routeLinks: IManagedCaddyNotFoundRouteLink[] = await readActiveRouteLinks(routesDirectoryPath);

  await mkdir(sitePaths.directoryPath, { recursive: true });
  await writeFile(sitePaths.pagePath, renderManagedCaddyNotFoundPage(routeLinks), "utf8");
  await writeFile(sitePaths.stylesheetPath, managedCaddyNotFoundPageCss, "utf8");
}

async function readActiveRouteLinks(routesDirectoryPath: string): Promise<IManagedCaddyNotFoundRouteLink[]> {
  const registrationsDirectoryPath: string = join(routesDirectoryPath, ".registrations");
  const registrationFileNames: string[] = await readdir(registrationsDirectoryPath);
  const routeLinksByHost: Map<string, IManagedCaddyNotFoundRouteLink> = new Map<
    string,
    IManagedCaddyNotFoundRouteLink
  >();

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const registrationPath: string = join(registrationsDirectoryPath, registrationFileName);
    const registration: IManagedRouteRegistration = parseManagedRouteRegistration(
      await readFile(registrationPath, "utf8"),
    );
    const routeFilePath: string = await readRouteFilePath(registration.host, registrationFileName, routesDirectoryPath);

    if (!(await pathExists(routeFilePath))) {
      continue;
    }

    const existingLink: IManagedCaddyNotFoundRouteLink | undefined = routeLinksByHost.get(registration.host);
    const candidateLink: IManagedCaddyNotFoundRouteLink = {
      host: registration.host,
      path: registration.path,
      url: createRouteUrl(registration.host, registration.path),
    };

    if (existingLink === undefined || compareRouteLinks(candidateLink, existingLink) < 0) {
      routeLinksByHost.set(registration.host, candidateLink);
    }
  }

  return [...routeLinksByHost.values()].sort(compareRouteLinks);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseManagedRouteRegistration(registrationText: string): IManagedRouteRegistration {
  const parsedValue: unknown = JSON.parse(registrationText);

  if (isManagedRouteRegistration(parsedValue)) {
    return {
      host: parsedValue.host,
      path: normalizeRoutePath(parsedValue.path),
    };
  }

  if (isLegacyManagedRouteRegistration(parsedValue)) {
    return {
      host: parsedValue.host,
      path: normalizeRoutePath(parsedValue.path ?? "/"),
    };
  }

  throw new Error("Managed route registration is malformed.");
}

function isManagedRouteRegistration(value: unknown): value is IManagedRouteRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "host") === "string" &&
    typeof Reflect.get(value, "path") === "string"
  );
}

function isLegacyManagedRouteRegistration(value: unknown): value is ILegacyManagedRouteRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "host") === "string" &&
    (Reflect.get(value, "path") === undefined || typeof Reflect.get(value, "path") === "string")
  );
}

function normalizeRoutePath(path: string): string {
  if (path === "/" || path === "/*") {
    return "/";
  }

  return path;
}

function createRouteUrl(host: string, path: string): string {
  const routeUrl = new URL(`https://${host}`);

  routeUrl.pathname = normalizeRoutePath(path);

  return routeUrl.toString();
}

function compareRouteLinks(left: IManagedCaddyNotFoundRouteLink, right: IManagedCaddyNotFoundRouteLink): number {
  const hostComparison: number = left.host.localeCompare(right.host);

  if (hostComparison !== 0) {
    return hostComparison;
  }

  return left.path.localeCompare(right.path);
}

function encodePathSegment(value: string): string {
  return value.replaceAll(":", "_");
}

async function readRouteFilePath(
  host: string,
  registrationFileName: string,
  routesDirectoryPath: string,
): Promise<string> {
  const hostRoutePath: string = join(routesDirectoryPath, `${encodePathSegment(host)}.caddy`);

  if (await pathExists(hostRoutePath)) {
    return hostRoutePath;
  }

  return join(routesDirectoryPath, registrationFileName.replace(/\.json$/, ".caddy"));
}
