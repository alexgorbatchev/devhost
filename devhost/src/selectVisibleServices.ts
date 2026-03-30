import type { ServiceHealth } from "./devtools/types";

export function selectVisibleServices(services: ServiceHealth[]): ServiceHealth[] {
  if (services.length === 0) {
    return [];
  }

  const unhealthyServices: ServiceHealth[] = services.filter((service: ServiceHealth): boolean => {
    return !service.status;
  });

  if (unhealthyServices.length > 0) {
    return unhealthyServices;
  }

  return [services[0]];
}
