import type { HealthResponse, ServiceHealth } from "../devtools/shared/types";
import { createManagedCaddyUrl, defaultManagedCaddyHttpsPort } from "../caddy/managedCaddyPorts";
import type { IResolvedDevhostService } from "../types/stackTypes";
import { checkServiceHealth } from "./waitForServiceHealth";

export interface IManagedSubprocess {
  exitCode: number | null;
  exited: Promise<number>;
}

export interface IManagedService {
  childProcess: IManagedSubprocess;
  service: IResolvedDevhostService;
}

export type ManagedServiceEntry = [string, IManagedService];

export async function collectManagedServicesHealth(
  devhostServiceName: string,
  managedServices: IResolvedDevhostService[],
  startedServices: IManagedService[],
  httpsPort: number = defaultManagedCaddyHttpsPort,
): Promise<HealthResponse> {
  const startedServicesByName: Map<string, IManagedService> = new Map(
    startedServices.map((startedService: IManagedService): ManagedServiceEntry => {
      return [startedService.service.name, startedService];
    }),
  );
  const services: ServiceHealth[] = await Promise.all(
    managedServices.map(async (managedService: IResolvedDevhostService): Promise<ServiceHealth> => {
      const startedService: IManagedService | undefined = startedServicesByName.get(managedService.name);

      if (startedService === undefined || startedService.childProcess.exitCode !== null) {
        return createServiceHealth(managedService, false, httpsPort);
      }

      const status: boolean = await checkServiceHealth(managedService.health);

      return createServiceHealth(managedService, status, httpsPort);
    }),
  );

  return {
    services,
  };
}

function createServiceHealth(service: IResolvedDevhostService, status: boolean, httpsPort: number): ServiceHealth {
  const url: string | undefined = readServiceUrl(service, httpsPort);

  return url === undefined
    ? {
        name: service.name,
        status,
      }
    : {
        name: service.name,
        status,
        url,
      };
}

function readServiceUrl(service: IResolvedDevhostService, httpsPort: number): string | undefined {
  if (service.host === null || service.path === null) {
    return undefined;
  }

  return createManagedCaddyUrl("https", service.host, httpsPort, normalizeServiceUrlPath(service.path));
}

function normalizeServiceUrlPath(path: string): string {
  if (path === "/" || path === "/*") {
    return "/";
  }

  return path.endsWith("/*") ? path.slice(0, -1) : path;
}
