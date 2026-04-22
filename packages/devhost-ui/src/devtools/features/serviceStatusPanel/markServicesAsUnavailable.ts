import type { ServiceHealth } from "../../shared/types";

export function markServicesAsUnavailable(services: ServiceHealth[], fallbackServiceName: string): ServiceHealth[] {
  if (services.length === 0) {
    return [
      {
        name: fallbackServiceName,
        status: false,
      },
    ];
  }

  return services.map((service: ServiceHealth): ServiceHealth => {
    return service.url === undefined
      ? {
          name: service.name,
          status: false,
        }
      : {
          name: service.name,
          status: false,
          url: service.url,
        };
  });
}
