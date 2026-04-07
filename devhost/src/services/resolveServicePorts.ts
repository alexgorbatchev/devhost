import getPort from "get-port";

import type {
  IResolvedDevhostManifest,
  IResolvedDevhostService,
  IValidatedDevhostManifest,
  IValidatedDevhostService,
  ResolvedHealthConfig,
} from "../types/stackTypes";

export async function resolveServicePorts(manifest: IValidatedDevhostManifest): Promise<IResolvedDevhostManifest> {
  const excludedPortsByHost: Map<string, Set<number>> = collectFixedPorts(manifest.services);
  const resolvedServices: Record<string, IResolvedDevhostService> = {};

  for (const serviceName of Object.keys(manifest.services)) {
    const service: IValidatedDevhostService = manifest.services[serviceName];
    const excludedPorts: Set<number> = excludedPortsByHost.get(service.bindHost) ?? new Set<number>();
    let resolvedPort: number | null = null;
    let portSource: IResolvedDevhostService["portSource"] = "none";

    if (typeof service.port === "number") {
      resolvedPort = service.port;
      portSource = "fixed";
    } else if (service.port === "auto") {
      resolvedPort = await getPort({
        exclude: excludedPorts,
        host: service.bindHost,
        reserve: true,
      });
      excludedPorts.add(resolvedPort);
      excludedPortsByHost.set(service.bindHost, excludedPorts);
      portSource = "auto";
    }

    const health: ResolvedHealthConfig = resolveHealthConfig(service, resolvedPort);
    const runtimeBindPortKey: string | null = resolvedPort === null ? null : `${service.bindHost}:${resolvedPort}`;

    if (runtimeBindPortKey !== null && hasRuntimeBindPortConflict(runtimeBindPortKey, resolvedServices)) {
      throw new Error(`Resolved runtime bind port is duplicated: ${runtimeBindPortKey}`);
    }

    resolvedServices[serviceName] = {
      bindHost: service.bindHost,
      command: service.command,
      cwd: service.cwd,
      dependsOn: service.dependsOn,
      env: service.env,
      name: service.name,
      port: resolvedPort,
      portSource,
      host: service.host,
      health,
    };
  }

  return {
    agent: manifest.agent,
    caddy: manifest.caddy,
    devtools: manifest.devtools,
    manifestDirectoryPath: manifest.manifestDirectoryPath,
    manifestPath: manifest.manifestPath,
    name: manifest.name,
    primaryService: manifest.primaryService,
    services: resolvedServices,
  };
}

function collectFixedPorts(services: Record<string, IValidatedDevhostService>): Map<string, Set<number>> {
  const excludedPortsByHost: Map<string, Set<number>> = new Map<string, Set<number>>();

  for (const serviceName of Object.keys(services)) {
    const service: IValidatedDevhostService = services[serviceName];

    if (typeof service.port !== "number") {
      continue;
    }

    const excludedPorts: Set<number> = excludedPortsByHost.get(service.bindHost) ?? new Set<number>();

    excludedPorts.add(service.port);
    excludedPortsByHost.set(service.bindHost, excludedPorts);
  }

  return excludedPortsByHost;
}

function resolveHealthConfig(service: IValidatedDevhostService, resolvedPort: number | null): ResolvedHealthConfig {
  const baseHealth = {
    interval: service.health?.interval ?? 200,
    timeout: service.health?.timeout ?? 30_000,
    retries: service.health?.retries ?? 0,
  };

  if (service.health !== null) {
    if ("tcp" in service.health) {
      return {
        kind: "tcp",
        host: service.bindHost,
        port: service.health.tcp,
        ...baseHealth,
      };
    }

    if ("http" in service.health) {
      return {
        kind: "http",
        url: service.health.http,
        ...baseHealth,
      };
    }

    return { kind: "process", ...baseHealth };
  }

  if (resolvedPort === null) {
    throw new Error(`Service ${service.name} is missing an effective health check.`);
  }

  return {
    kind: "tcp",
    host: service.bindHost,
    port: resolvedPort,
    interval: 200,
    timeout: 30_000,
    retries: 0,
  };
}

function hasRuntimeBindPortConflict(
  runtimeBindPortKey: string,
  resolvedServices: Record<string, IResolvedDevhostService>,
): boolean {
  for (const existingServiceName of Object.keys(resolvedServices)) {
    const existingService: IResolvedDevhostService = resolvedServices[existingServiceName];

    if (existingService.port === null) {
      continue;
    }

    if (`${existingService.bindHost}:${existingService.port}` === runtimeBindPortKey) {
      return true;
    }
  }

  return false;
}
