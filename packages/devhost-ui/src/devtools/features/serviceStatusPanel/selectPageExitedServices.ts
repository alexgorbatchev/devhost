import type { IRoutedServiceIdentity } from "../../shared/routedServices";
import type { ServiceHealth } from "../../shared/types";

/**
 * Keeps the exited services that break this page: its own service and what that service depends on. Any other exit
 * stays in the Services panel, because a page that still works should stay usable.
 */
export function selectPageExitedServices(
  exitedServices: ServiceHealth[],
  pageService: IRoutedServiceIdentity | null,
): ServiceHealth[] {
  if (pageService === null) {
    return [];
  }

  const { dependencies = [], serviceName } = pageService;

  return exitedServices.filter((service) => service.name === serviceName || dependencies.includes(service.name));
}
