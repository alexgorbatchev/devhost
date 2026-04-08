import { homedir } from "node:os";
import { join } from "node:path";

const defaultAdminAddress: string = "127.0.0.1:20193";
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

export function resolveManagedCaddyAdminAddress(environment: NodeJS.ProcessEnv = process.env): string {
  const configuredAddress: string | undefined = environment.DEVHOST_CADDY_ADMIN_ADDRESS;

  if (configuredAddress === undefined) {
    return defaultAdminAddress;
  }

  const trimmedAddress: string = configuredAddress.trim();

  if (trimmedAddress.length === 0) {
    return defaultAdminAddress;
  }

  return trimmedAddress;
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
export const caddyAdminApiUrl: string = `http://${managedCaddyAdminAddress}/config/`;
