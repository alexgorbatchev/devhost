import type { ServiceHealth } from "./devtools/types";

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
    return {
      name: service.name,
      status: false,
    };
  });
}
