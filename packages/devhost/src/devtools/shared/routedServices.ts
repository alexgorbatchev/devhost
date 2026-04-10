export interface IRoutedServiceIdentity {
  host: string;
  path: string;
  serviceName: string;
}

interface IParsedRoutedServicePath {
  basePath: string;
  kind: "exact" | "prefix";
}

export function normalizeRoutedServicePath(path: string | null | undefined): string {
  if (path === undefined || path === null || path === "/" || path === "/*") {
    return "/";
  }

  return path;
}

export function createRoutedServiceKey(service: Pick<IRoutedServiceIdentity, "host" | "path">): string {
  return `${service.host.toLowerCase()}|${normalizeRoutedServicePath(service.path)}`;
}

export function resolveRoutedServiceKeyForUrl(services: IRoutedServiceIdentity[], urlText: string): string | null {
  const matchedService = resolveRoutedServiceForUrl(services, urlText);

  return matchedService === null ? null : createRoutedServiceKey(matchedService);
}

export function resolveRoutedServiceForUrl(
  services: IRoutedServiceIdentity[],
  urlText: string,
): IRoutedServiceIdentity | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlText);
  } catch {
    return null;
  }

  let bestMatch: IRoutedServiceIdentity | null = null;
  let bestMatchWeight: number = Number.NEGATIVE_INFINITY;

  for (const service of services) {
    if (service.host.toLowerCase() !== parsedUrl.hostname.toLowerCase()) {
      continue;
    }

    const normalizedPath: string = normalizeRoutedServicePath(service.path);

    if (!doesRoutedServiceMatchPath(normalizedPath, parsedUrl.pathname)) {
      continue;
    }

    const matchWeight: number = readRoutedServicePathWeight(normalizedPath);

    if (
      bestMatch === null ||
      matchWeight > bestMatchWeight ||
      (matchWeight === bestMatchWeight && service.serviceName.localeCompare(bestMatch.serviceName) < 0)
    ) {
      bestMatch = service;
      bestMatchWeight = matchWeight;
    }
  }

  return bestMatch;
}

function doesRoutedServiceMatchPath(routePath: string, pathname: string): boolean {
  if (routePath === "/") {
    return true;
  }

  const parsedRoutePath: IParsedRoutedServicePath = parseRoutedServicePath(routePath);

  if (parsedRoutePath.kind === "exact") {
    return pathname === parsedRoutePath.basePath;
  }

  return pathname.startsWith(`${parsedRoutePath.basePath}/`);
}

function readRoutedServicePathWeight(path: string): number {
  if (path === "/") {
    return -1;
  }

  const parsedRoutePath: IParsedRoutedServicePath = parseRoutedServicePath(path);
  const wildcardPenalty: number = parsedRoutePath.kind === "prefix" ? 0 : 1;

  return parsedRoutePath.basePath.length * 10 + wildcardPenalty;
}

function parseRoutedServicePath(path: string): IParsedRoutedServicePath {
  if (path.endsWith("/*")) {
    return {
      basePath: path.slice(0, -2),
      kind: "prefix",
    };
  }

  return {
    basePath: path,
    kind: "exact",
  };
}
