export const defaultManagedCaddyHttpPort: number = 80;
export const defaultManagedCaddyHttpsPort: number = 443;

type ManagedCaddyProtocol = "http" | "https";

export function formatManagedCaddySiteAddress(protocol: ManagedCaddyProtocol, port: number, host?: string): string {
  return `${protocol}://${host ?? ""}${port === readDefaultManagedCaddyPort(protocol) ? "" : `:${port}`}`;
}

export function createManagedCaddyUrl(
  protocol: ManagedCaddyProtocol,
  host: string,
  port: number,
  path: string,
): string {
  const routeUrl: URL = new URL(`${protocol}://${host}`);

  if (port !== readDefaultManagedCaddyPort(protocol)) {
    routeUrl.port = String(port);
  }

  routeUrl.pathname = path;

  return routeUrl.toString();
}

function readDefaultManagedCaddyPort(protocol: ManagedCaddyProtocol): number {
  return protocol === "http" ? defaultManagedCaddyHttpPort : defaultManagedCaddyHttpsPort;
}
