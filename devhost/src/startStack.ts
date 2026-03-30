import { signalExitCodes, supportedSignals, type SupportedSignal } from "./constants";
import { collectManagedServicesHealth } from "./collectManagedServicesHealth";
import type { IDevhostLogger } from "./createLogger";
import { pipeSubprocessOutput } from "./pipeSubprocessOutput";
import {
  activateRoute,
  claimRegistration,
  cleanupStaleRegistrations,
  ensureCaddyAdminAvailable,
  ensureCaddyfileExists,
  ensureRouteDirectories,
  removeRouteFiles,
  unregisterRoute,
} from "./routeUtils";
import { resolveProxyHost } from "./resolveProxyHost";
import { startDevtoolsControlServer } from "./startDevtoolsControlServer";
import { startDocumentInjectionServer } from "./startDocumentInjectionServer";
import type { IInjectedServiceEnvironment, IResolvedDevhostManifest, IResolvedDevhostService } from "./stackTypes";
import { waitForServiceHealth } from "./waitForServiceHealth";

const shutdownGracePeriodInMilliseconds: number = 10_000;

export interface IStartStackOptions {
  pipeServiceOutput?: boolean;
  runtimeMode?: "manifest" | "single-service";
  stdinMode?: "ignore" | "inherit";
}

type StartedService = {
  childProcess: Bun.Subprocess;
  service: IResolvedDevhostService;
};

export async function startStack(
  manifest: IResolvedDevhostManifest,
  serviceOrder: string[],
  logger: IDevhostLogger,
  options: IStartStackOptions = {},
): Promise<number> {
  const resolvedOptions: Required<IStartStackOptions> = {
    pipeServiceOutput: options.pipeServiceOutput ?? true,
    runtimeMode: options.runtimeMode ?? "manifest",
    stdinMode: options.stdinMode ?? "ignore",
  };
  const startedServices: StartedService[] = [];
  const reservedHosts: string[] = [];
  const activeHosts: Set<string> = new Set<string>();
  const documentInjectionServers: Map<string, ReturnType<typeof startDocumentInjectionServer>> = new Map();
  const managedServices: IResolvedDevhostService[] = serviceOrder.map((serviceName: string): IResolvedDevhostService => {
    return manifest.services[serviceName];
  });
  const routedServices: IResolvedDevhostService[] = Object.values(manifest.services).filter(
    (service: IResolvedDevhostService): boolean => service.host !== null,
  );
  let devtoolsControlServer: Awaited<ReturnType<typeof startDevtoolsControlServer>> | null = null;
  let receivedSignal: SupportedSignal | null = null;
  let resolveSignal: ((signal: SupportedSignal) => void) | null = null;
  const signalHandlers: Array<{
    handler: () => void;
    signalName: SupportedSignal;
  }> = [];
  const signalPromise: Promise<SupportedSignal> = new Promise<SupportedSignal>((resolve) => {
    resolveSignal = resolve;
  });

  try {
    await ensureRouteDirectories();
    await ensureCaddyfileExists();
    await cleanupStaleRegistrations();
    await ensureCaddyAdminAvailable();

    for (const service of routedServices) {
      if (service.host === null || service.port === null) {
        continue;
      }

      await claimRegistration(service.host, service.port);
      reservedHosts.push(service.host);
    }

    if (manifest.devtools && routedServices.length > 0) {
      devtoolsControlServer = await startDevtoolsControlServer({
        getHealthResponse: async () => {
          return await collectManagedServicesHealth(managedServices, startedServices);
        },
      });
    }

    for (const signalName of supportedSignals) {
      const handler = (): void => {
        receivedSignal = signalName;
        resolveSignal?.(signalName);

        for (const startedService of startedServices) {
          if (!startedService.childProcess.killed && startedService.childProcess.exitCode === null) {
            startedService.childProcess.kill(signalName);
          }
        }
      };

      signalHandlers.push({
        handler,
        signalName,
      });
      process.on(signalName, handler);
    }

    for (const serviceName of serviceOrder) {
      const service: IResolvedDevhostService = manifest.services[serviceName];
      const childEnvironment: Record<string, string | undefined> = {
        ...process.env,
        ...service.env,
        ...createInjectedServiceEnvironment(manifest, service, resolvedOptions.runtimeMode),
      };
      const childProcess = resolvedOptions.pipeServiceOutput
        ? Bun.spawn(service.command, {
            cwd: service.cwd,
            env: childEnvironment,
            stderr: "pipe",
            stdin: resolvedOptions.stdinMode,
            stdout: "pipe",
          })
        : Bun.spawn(service.command, {
            cwd: service.cwd,
            env: childEnvironment,
            stderr: "inherit",
            stdin: resolvedOptions.stdinMode,
            stdout: "inherit",
          });

      startedServices.push({
        childProcess,
        service,
      });

      if (resolvedOptions.pipeServiceOutput) {
        void pipeSubprocessOutput(childProcess.stdout, `[${service.name}] `, (line: string) => {
          console.log(line);
        });
        void pipeSubprocessOutput(childProcess.stderr, `[${service.name}] `, (line: string) => {
          console.error(line);
        });
      }

      await waitForServiceHealth({
        childProcess,
        health: service.health,
        serviceName,
      });

      if (service.host !== null && service.port !== null) {
        if (manifest.devtools) {
          const documentInjectionServer = startDocumentInjectionServer({
            backendHost: resolveProxyHost(service.bindHost),
            backendPort: service.port,
          });

          documentInjectionServers.set(service.name, documentInjectionServer);
          await activateRoute({
            appBindHost: service.bindHost,
            appPort: service.port,
            devtoolsControlPort: devtoolsControlServer?.port,
            documentInjectionPort: documentInjectionServer.port,
            host: service.host,
          });
        } else {
          await activateRoute({
            appBindHost: service.bindHost,
            appPort: service.port,
            host: service.host,
          });
        }

        activeHosts.add(service.host);
      }
    }

    logPrimaryService(manifest, logger);

    const raceResult:
      | {
          type: "signal";
          signal: SupportedSignal;
        }
      | {
          type: "exit";
          serviceName: string;
          exitCode: number;
        } = await Promise.race([
      signalPromise.then(
        (signal): {
          type: "signal";
          signal: SupportedSignal;
        } => ({
          signal,
          type: "signal",
        }),
      ),
      waitForAnyServiceExit(startedServices).then(
        (result): {
          type: "exit";
          serviceName: string;
          exitCode: number;
        } => ({
          ...result,
          type: "exit",
        }),
      ),
    ]);

    if (raceResult.type === "signal") {
      return signalExitCodes[raceResult.signal];
    }

    return raceResult.exitCode;
  } catch (error) {
    if (receivedSignal !== null) {
      return signalExitCodes[receivedSignal];
    }

    throw error;
  } finally {
    for (const { handler, signalName } of signalHandlers) {
      process.off(signalName, handler);
    }

    await stopStartedServices(startedServices);

    for (const [serviceName, documentInjectionServer] of documentInjectionServers.entries()) {
      await documentInjectionServer.stop();
      documentInjectionServers.delete(serviceName);
    }

    if (devtoolsControlServer !== null) {
      await devtoolsControlServer.stop();
    }

    for (const host of activeHosts) {
      await unregisterRoute(host);
    }

    for (const host of reservedHosts) {
      if (!activeHosts.has(host)) {
        await removeRouteFiles(host);
      }
    }
  }
}

export function createInjectedServiceEnvironment(
  manifest: IResolvedDevhostManifest,
  service: IResolvedDevhostService,
  runtimeMode: "manifest" | "single-service" = "manifest",
): IInjectedServiceEnvironment {
  const environment: IInjectedServiceEnvironment = {
    DEVHOST_BIND_HOST: service.bindHost,
  };

  if (runtimeMode === "manifest") {
    environment.DEVHOST_MANIFEST_PATH = manifest.manifestPath;
    environment.DEVHOST_SERVICE_NAME = service.name;
    environment.DEVHOST_STACK = manifest.name;
  }

  if (service.port !== null) {
    environment.PORT = String(service.port);
  }

  if (service.host !== null) {
    environment.DEVHOST_HOST = service.host;
  }

  return environment;
}

async function waitForAnyServiceExit(startedServices: StartedService[]): Promise<{ serviceName: string; exitCode: number }> {
  return await Promise.race(
    startedServices.map(async (startedService) => {
      const exitCode: number = await startedService.childProcess.exited;

      return {
        exitCode,
        serviceName: startedService.service.name,
      };
    }),
  );
}

async function stopStartedServices(startedServices: StartedService[]): Promise<void> {
  for (const startedService of [...startedServices].reverse()) {
    const { childProcess } = startedService;

    if (childProcess.exitCode === null && !childProcess.killed) {
      childProcess.kill("SIGTERM");
    }
  }

  for (const startedService of [...startedServices].reverse()) {
    const { childProcess } = startedService;

    if (childProcess.exitCode !== null) {
      await childProcess.exited;
      continue;
    }

    const didExitGracefully: boolean = await waitForExitWithinGracePeriod(childProcess);

    if (didExitGracefully) {
      continue;
    }

    if (!childProcess.killed && childProcess.exitCode === null) {
      childProcess.kill("SIGKILL");
    }

    await childProcess.exited;
  }
}

async function waitForExitWithinGracePeriod(childProcess: Bun.Subprocess): Promise<boolean> {
  const gracefulExitResult: number | null = await Promise.race([
    childProcess.exited,
    Bun.sleep(shutdownGracePeriodInMilliseconds).then(() => null),
  ]);

  return gracefulExitResult !== null;
}

function logPrimaryService(manifest: IResolvedDevhostManifest, logger: IDevhostLogger): void {
  const primaryService: IResolvedDevhostService = manifest.services[manifest.primaryService];

  if (primaryService.host !== null) {
    logger.info(`primary https://${primaryService.host}`);
    return;
  }

  if (primaryService.port !== null) {
    logger.info(`primary ${primaryService.name} -> http://${resolveProxyHost(primaryService.bindHost)}:${primaryService.port}`);
  }
}
