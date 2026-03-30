import { DEVHOST_SERVICE_NAME } from "./devtools/constants";
import type { ServiceHealth } from "./devtools/types";

export function markServicesAsUnavailable(services: ServiceHealth[]): ServiceHealth[] {
  if (services.length === 0) {
    return [
      {
        name: DEVHOST_SERVICE_NAME,
        status: false,
      },
    ];
  }

  return services.map((service: ServiceHealth): ServiceHealth => {
    return {
      name: service.name,
      status: false,
    };
  });
}
