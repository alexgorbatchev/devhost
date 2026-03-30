import type { HealthResponse, ServiceHealth } from "./devtools/types";
import type { IResolvedDevhostService } from "./stackTypes";
import { checkServiceHealth } from "./waitForServiceHealth";

export interface IManagedSubprocess {
  exitCode: number | null;
  exited: Promise<number>;
}

export interface IManagedService {
  childProcess: IManagedSubprocess;
  service: IResolvedDevhostService;
}

export async function collectManagedServicesHealth(
  managedServices: IResolvedDevhostService[],
  startedServices: IManagedService[],
): Promise<HealthResponse> {
  const startedServicesByName: Map<string, IManagedService> = new Map(
    startedServices.map((startedService: IManagedService): [string, IManagedService] => {
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
    services,
  };
}
