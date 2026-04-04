import type { HealthResponse, ServiceHealth } from "../devtools/shared/types";
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
        return {
          name: managedService.name,
          status: false,
        };
      }

      const status: boolean = await checkServiceHealth(managedService.health);

      return {
        name: managedService.name,
        status,
      };
    }),
  );

  return {
    services: [
      {
        name: devhostServiceName,
        status: true,
      },
      ...services,
    ],
  };
}
