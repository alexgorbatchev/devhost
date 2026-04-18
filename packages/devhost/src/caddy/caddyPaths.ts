import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const defaultManagedCaddyAdminAddress: string = "127.0.0.1:20197";
const defaultStateDirectorySegments: string[] = [".local", "state", "devhost"];

export interface IManagedCaddyPaths {
  caddyDirectoryPath: string;
  caddyfilePath: string;
  hostClaimsDirectoryPath: string;
  pidFilePath: string;
  portClaimsDirectoryPath: string;
  registrationsDirectoryPath: string;
  rootCertificatePath: string;
  routesDirectoryPath: string;
  stateDirectoryPath: string;
  storageDirectoryPath: string;
}

export function createManagedCaddyPathsForRoutesDirectory(routesDirectoryPath: string): IManagedCaddyPaths {
  const caddyDirectoryPath: string = dirname(routesDirectoryPath);
  const stateDirectoryPath: string = dirname(caddyDirectoryPath);

  return createManagedCaddyPaths(stateDirectoryPath);
}

export function createCaddyAdminApiUrl(adminAddress: string): string {
  return `http://${adminAddress}/config/`;
}

export function resolveManagedCaddyAdminAddress(manifestAdminAddress?: string): string {
  return manifestAdminAddress?.trim().length ? manifestAdminAddress.trim() : defaultManagedCaddyAdminAddress;
}

export function resolveDevhostStateDirectoryPath(environment: NodeJS.ProcessEnv = process.env): string {
  const configuredStateDirectoryPath: string | undefined = environment.DEVHOST_STATE_DIR;

  if (configuredStateDirectoryPath !== undefined) {
    const trimmedStateDirectoryPath: string = configuredStateDirectoryPath.trim();

    if (trimmedStateDirectoryPath.length > 0) {
      return trimmedStateDirectoryPath;
    }
  }

  const configuredXdgStateHome: string | undefined = environment.XDG_STATE_HOME;

  if (configuredXdgStateHome !== undefined) {
    const trimmedXdgStateHome: string = configuredXdgStateHome.trim();

    if (trimmedXdgStateHome.length > 0) {
      return join(trimmedXdgStateHome, "devhost");
    }
  }

  const homeDirectoryPath: string = environment.HOME?.trim() ?? homedir().trim();

  if (homeDirectoryPath.length === 0) {
    throw new Error("Could not determine the devhost state directory. Set DEVHOST_STATE_DIR or HOME.");
  }

  return join(homeDirectoryPath, ...defaultStateDirectorySegments);
}

export function createManagedCaddyPaths(
  stateDirectoryPath: string = resolveDevhostStateDirectoryPath(),
): IManagedCaddyPaths {
  const caddyDirectoryPath: string = join(stateDirectoryPath, "caddy");
  const routesDirectoryPath: string = join(caddyDirectoryPath, "routes");

  return {
    caddyDirectoryPath,
    caddyfilePath: join(caddyDirectoryPath, "Caddyfile"),
    hostClaimsDirectoryPath: join(routesDirectoryPath, ".host-claims"),
    pidFilePath: join(caddyDirectoryPath, "caddy.pid"),
    portClaimsDirectoryPath: join(caddyDirectoryPath, "port-claims"),
    registrationsDirectoryPath: join(routesDirectoryPath, ".registrations"),
    rootCertificatePath: join(caddyDirectoryPath, "storage", "pki", "authorities", "local", "root.crt"),
    routesDirectoryPath,
    stateDirectoryPath,
    storageDirectoryPath: join(caddyDirectoryPath, "storage"),
  };
}

export const managedCaddyAdminAddress: string = resolveManagedCaddyAdminAddress();
export const managedCaddyPaths: IManagedCaddyPaths = createManagedCaddyPaths();
export const caddyAdminApiUrl: string = createCaddyAdminApiUrl(managedCaddyAdminAddress);
