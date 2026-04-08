import getPort from "get-port";

import type { IResolvedDevhostManifest, IResolvedDevhostService } from "../types/stackTypes";

export const maximumAutoPortRetryCount: number = 3;

const autoPortBindCollisionPattern: RegExp = /EADDRINUSE|address already in use|bind: address already in use/i;

export function shouldRetryAutoPortStartup(
  service: IResolvedDevhostService,
  error: unknown,
  outputLines: string[],
  retryCount: number,
): boolean {
  if (service.portSource !== "auto" || retryCount >= maximumAutoPortRetryCount) {
    return false;
  }

  const errorMessage: string = error instanceof Error ? error.message : String(error);
  const combinedOutput: string = [errorMessage, ...outputLines].join("\n");

  return autoPortBindCollisionPattern.test(combinedOutput);
}

export async function reassignAutoPort(
  manifest: IResolvedDevhostManifest,
  serviceName: string,
): Promise<IResolvedDevhostService> {
  const service: IResolvedDevhostService = manifest.services[serviceName];
  const excludedPorts: Set<number> = collectExcludedPorts(manifest, service.bindHost, serviceName);
  const nextPort: number = await getPort({
    exclude: excludedPorts,
    host: service.bindHost,
    reserve: true,
  });

  service.port = nextPort;
  service.health = {
    host: service.bindHost,
    interval: 200,
    kind: "tcp",
    port: nextPort,
    retries: 0,
    timeout: 30_000,
  };

  return service;
}

function collectExcludedPorts(
  manifest: IResolvedDevhostManifest,
  bindHost: string,
  targetServiceName: string,
): Set<number> {
  const excludedPorts: Set<number> = new Set<number>();

  for (const [serviceName, service] of Object.entries(manifest.services)) {
    if (service.bindHost !== bindHost || service.port === null || serviceName === targetServiceName) {
      continue;
    }

    excludedPorts.add(service.port);
  }

  const targetService: IResolvedDevhostService = manifest.services[targetServiceName];

  if (targetService.port !== null) {
    excludedPorts.add(targetService.port);
  }

  return excludedPorts;
}
