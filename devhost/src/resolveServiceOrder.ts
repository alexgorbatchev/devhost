import type { IValidatedDevhostManifest } from "./stackTypes";

export function resolveServiceOrder(manifest: IValidatedDevhostManifest): string[] {
  const visitingServices: Set<string> = new Set<string>();
  const visitedServices: Set<string> = new Set<string>();
  const orderedServices: string[] = [];
  const serviceNames: string[] = Object.keys(manifest.services);

  for (const serviceName of serviceNames) {
    visitService(serviceName, manifest.services, visitingServices, visitedServices, orderedServices, []);
  }

  return orderedServices;
}

function visitService(
  serviceName: string,
  services: IValidatedDevhostManifest["services"],
  visitingServices: Set<string>,
  visitedServices: Set<string>,
  orderedServices: string[],
  ancestry: string[],
): void {
  if (visitedServices.has(serviceName)) {
    return;
  }

  if (visitingServices.has(serviceName)) {
    throw new Error(`Dependency cycle detected: ${[...ancestry, serviceName].join(" -> ")}`);
  }

  visitingServices.add(serviceName);

  for (const dependencyName of services[serviceName].dependsOn) {
    visitService(
      dependencyName,
      services,
      visitingServices,
      visitedServices,
      orderedServices,
      [...ancestry, serviceName],
    );
  }

  visitingServices.delete(serviceName);
  visitedServices.add(serviceName);
  orderedServices.push(serviceName);
}
