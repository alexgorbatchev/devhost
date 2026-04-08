import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createManagedCaddyNotFoundSitePaths } from "./createManagedCaddyNotFoundSitePaths";
import { managedCaddyNotFoundPageCss } from "./managedCaddyNotFoundPageCss";
import { renderManagedCaddyNotFoundPage, type IManagedCaddyNotFoundRouteLink } from "./renderManagedCaddyNotFoundPage";

interface IManagedRouteRegistration {
  host: string;
  path: string;
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
  const routeLinks: IManagedCaddyNotFoundRouteLink[] = [];
  const seenUrls: Set<string> = new Set<string>();

  for (const registrationFileName of registrationFileNames) {
    if (!registrationFileName.endsWith(".json")) {
      continue;
    }

    const routeFilePath: string = join(routesDirectoryPath, registrationFileName.replace(/\.json$/, ".caddy"));

    if (!(await pathExists(routeFilePath))) {
      continue;
    }

    const registrationPath: string = join(registrationsDirectoryPath, registrationFileName);
    const registrationText: string = await readFile(registrationPath, "utf8");
    const registration: IManagedRouteRegistration = parseManagedRouteRegistration(registrationText);
    const routeUrl: string = createRouteUrl(registration.host, registration.path);

    if (seenUrls.has(routeUrl)) {
      continue;
    }

    seenUrls.add(routeUrl);
    routeLinks.push({
      host: registration.host,
      path: registration.path,
      url: routeUrl,
    });
  }

  return routeLinks.sort(compareRouteLinks);
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

  if (!isRawManagedRouteRegistration(parsedValue)) {
    throw new Error("Managed route registration is malformed.");
  }

  return {
    host: parsedValue.host,
    path: normalizeRoutePath(parsedValue.path ?? "/"),
  };
}

interface IRawManagedRouteRegistration {
  host: string;
  path?: string;
  port: number;
  ownerPid: number;
  createdAt: string;
}

function isRawManagedRouteRegistration(value: unknown): value is IRawManagedRouteRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "host") === "string" &&
    (Reflect.get(value, "path") === undefined || typeof Reflect.get(value, "path") === "string") &&
    typeof Reflect.get(value, "port") === "number" &&
    typeof Reflect.get(value, "ownerPid") === "number" &&
    typeof Reflect.get(value, "createdAt") === "string"
  );
}

function normalizeRoutePath(path: string): string {
  if (path.length === 0 || path === "/") {
    return "/";
  }

  return path.startsWith("/") ? path : `/${path}`;
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
