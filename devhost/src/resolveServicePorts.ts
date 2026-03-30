import getPort from "get-port";

import type {
  IResolvedDevhostManifest,
  IResolvedDevhostService,
  IValidatedDevhostManifest,
  IValidatedDevhostService,
  ResolvedReadyConfig,
} from "./stackTypes";

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

    const ready: ResolvedReadyConfig = resolveReadyConfig(service, resolvedPort);
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
      publicHost: service.publicHost,
      ready,
    };
  }

  return {
    devtools: manifest.devtools,
    manifestDirectoryPath: manifest.manifestDirectoryPath,
    manifestPath: manifest.manifestPath,
    name: manifest.name,
    primaryService: manifest.primaryService,
    services: resolvedServices,
  };
}

function collectFixedPorts(
  services: Record<string, IValidatedDevhostService>,
): Map<string, Set<number>> {
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

function resolveReadyConfig(service: IValidatedDevhostService, resolvedPort: number | null): ResolvedReadyConfig {
  if (service.ready !== null) {
    if ("tcp" in service.ready) {
      return {
        kind: "tcp",
        host: service.bindHost,
        port: service.ready.tcp,
      };
    }

    if ("http" in service.ready) {
      return {
        kind: "http",
        url: service.ready.http,
      };
    }

    return { kind: "process" };
  }

  if (resolvedPort === null) {
    throw new Error(`Service ${service.name} is missing an effective readiness rule.`);
  }

  return {
    kind: "tcp",
    host: service.bindHost,
    port: resolvedPort,
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
