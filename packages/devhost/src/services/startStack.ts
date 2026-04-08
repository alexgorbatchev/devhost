import { managedCaddyPaths } from "../caddy/caddyPaths";
import { signalExitCodes, supportedSignals } from "../utils/constants";
import { collectManagedServicesHealth } from "./collectManagedServicesHealth";
import { createTerminalSessionCommand } from "../agents/createTerminalSessionCommand";
import type { IDevhostLogger } from "../utils/createLogger";
import { ensureManagedCaddyConfig } from "../caddy/ensureManagedCaddyConfig";
import { launchTerminalSession } from "../agents/launchTerminalSession";
import { pipeSubprocessOutput } from "./pipeSubprocessOutput";
import {
  activateRoute,
  claimRegistration,
  cleanupStaleRegistrations,
  ensureCaddyAdminAvailable,
  removeRouteFiles,
  unregisterRoute,
} from "../utils/routeUtils";
import { resolveProxyHost } from "../utils/resolveProxyHost";
import { startDevtoolsControlServer } from "../devtools-server/startDevtoolsControlServer";
import { startDocumentInjectionServer } from "../devtools-server/startDocumentInjectionServer";
import type {
  IInjectedServiceEnvironment,
  IResolvedDevhostManifest,
  IResolvedDevhostService,
  IServiceExitResult,
  ISignalHandlerRegistration,
  ISignalRaceResult,
  IExitRaceResult,
  RaceResult,
  SignalHandlerCallback,
  SupportedSignal,
} from "../types/stackTypes";
import { waitForServiceHealth } from "./waitForServiceHealth";

const shutdownGracePeriodInMilliseconds: number = 10_000;

export interface IStartStackOptions {
  pipeServiceOutput?: boolean;
  stdinMode?: "ignore" | "inherit";
}

type StartedService = {
  childProcess: Bun.Subprocess;
  service: IResolvedDevhostService;
};

type ReservedHost = {
  host: string;
  serviceName: string;
};

export async function startStack(
  manifest: IResolvedDevhostManifest,
  serviceOrder: string[],
  logger: IDevhostLogger,
  options: IStartStackOptions = {},
): Promise<number> {
  const resolvedOptions: Required<IStartStackOptions> = {
    pipeServiceOutput: options.pipeServiceOutput ?? true,
    stdinMode: options.stdinMode ?? "ignore",
  };
  const startedServices: StartedService[] = [];
  const reservedHosts: ReservedHost[] = [];
  const activeHosts: Set<string> = new Set<string>();
  const documentInjectionServers: Map<string, ReturnType<typeof startDocumentInjectionServer>> = new Map();
  const managedServices: IResolvedDevhostService[] = serviceOrder.map(
    (serviceName: string): IResolvedDevhostService => {
      return manifest.services[serviceName];
    },
  );
  const routedServices: IResolvedDevhostService[] = Object.values(manifest.services).filter(
    (service: IResolvedDevhostService): boolean => service.host !== null,
  );
  let devtoolsControlServer: Awaited<ReturnType<typeof startDevtoolsControlServer>> | null = null;
  let receivedSignal: SupportedSignal | null = null;
  let resolveSignal: SignalHandlerCallback | null = null;
  const signalHandlers: ISignalHandlerRegistration[] = [];
  const signalPromise: Promise<SupportedSignal> = new Promise<SupportedSignal>((resolve) => {
    resolveSignal = resolve;
  });

  try {
    await ensureManagedCaddyConfig();
    await cleanupStaleRegistrations(managedCaddyPaths.registrationsDirectoryPath);
    await ensureCaddyAdminAvailable();

    for (const service of routedServices) {
      if (service.host === null || service.port === null) {
        continue;
      }

      await claimRegistration(
        service.name,
        service.host,
        service.path ?? "/",
        service.port,
        managedCaddyPaths.registrationsDirectoryPath,
      );
      reservedHosts.push({ serviceName: service.name, host: service.host });
    }

    const devtoolsEnabled =
      manifest.devtools.editor.enabled || manifest.devtools.minimap.enabled || manifest.devtools.status.enabled;

    if (devtoolsEnabled && routedServices.length > 0) {
      devtoolsControlServer = await startDevtoolsControlServer({
        agentDisplayName: manifest.agent.displayName,
        componentEditor: manifest.devtools.editor.ide,
        devtoolsMinimapPosition: manifest.devtools.minimap.position,
        devtoolsPosition: manifest.devtools.status.position,
        editorEnabled: manifest.devtools.editor.enabled,
        minimapEnabled: manifest.devtools.minimap.enabled,
        statusEnabled: manifest.devtools.status.enabled,
        getHealthResponse: async () => {
          return await collectManagedServicesHealth(manifest.name, managedServices, startedServices);
        },
        projectRootPath: manifest.manifestDirectoryPath,
        stackName: manifest.name,
        startTerminalSession: (request, onData) => {
          const terminalSessionCommand = createTerminalSessionCommand({
            agent: manifest.agent,
            componentEditor: manifest.devtools.editor.ide,
            projectRootPath: manifest.manifestDirectoryPath,
            request,
            stackName: manifest.name,
          });

          try {
            return launchTerminalSession({
              cleanup: terminalSessionCommand.cleanup,
              cols: 120,
              command: terminalSessionCommand.command,
              cwd: terminalSessionCommand.cwd,
              env: terminalSessionCommand.env,
              onData,
              rows: 80,
            });
          } catch (error) {
            terminalSessionCommand.cleanup();
            throw error;
          }
        },
      });
      await devtoolsControlServer.publishHealthResponse();
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
        ...createInjectedServiceEnvironment(manifest, service),
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
      void childProcess.exited.then(async (): Promise<void> => {
        await devtoolsControlServer?.publishHealthResponse();
      });
      await devtoolsControlServer?.publishHealthResponse();

      if (resolvedOptions.pipeServiceOutput) {
        void pipeSubprocessOutput(childProcess.stdout, `[${service.name}] `, (line: string) => {
          devtoolsControlServer?.publishLogEntry(service.name, "stdout", line);
          console.log(line);
        });
        void pipeSubprocessOutput(childProcess.stderr, `[${service.name}] `, (line: string) => {
          devtoolsControlServer?.publishLogEntry(service.name, "stderr", line);
          console.error(line);
        });
      }

      await waitForServiceHealth({
        childProcess,
        health: service.health,
        serviceName,
      });
      await devtoolsControlServer?.publishHealthResponse();

      if (service.host !== null && service.port !== null) {
        if (devtoolsEnabled && (service.path === null || service.path === "/" || service.path === "/*")) {
          const documentInjectionServer = startDocumentInjectionServer({
            backendHost: resolveProxyHost(service.bindHost),
            backendPort: service.port,
          });

          documentInjectionServers.set(service.name, documentInjectionServer);
          await activateRoute(
            {
              serviceName: service.name,
              appBindHost: service.bindHost,
              appPort: service.port,
              devtoolsControlPort: devtoolsControlServer?.port,
              documentInjectionPort: documentInjectionServer.port,
              host: service.host,
              path: service.path ?? "/",
            },
            managedCaddyPaths.routesDirectoryPath,
          );
        } else {
          await activateRoute(
            {
              serviceName: service.name,
              appBindHost: service.bindHost,
              appPort: service.port,
              host: service.host,
              path: service.path ?? "/",
            },
            managedCaddyPaths.routesDirectoryPath,
          );
        }

        activeHosts.add(service.name);
      }
    }

    logPrimaryService(manifest, logger);

    const raceResult: RaceResult = await Promise.race([
      signalPromise.then(
        (signal): ISignalRaceResult => ({
          signal,
          type: "signal",
        }),
      ),
      waitForAnyServiceExit(startedServices).then(
        (result): IExitRaceResult => ({
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

    for (const serviceName of activeHosts) {
      const activeService = routedServices.find((s) => s.name === serviceName);
      if (activeService && activeService.host) {
        await unregisterRoute(serviceName, activeService.host, managedCaddyPaths.registrationsDirectoryPath);
      }
    }

    for (const reserved of reservedHosts) {
      if (!activeHosts.has(reserved.serviceName)) {
        await removeRouteFiles(
          reserved.serviceName,
          reserved.host,
          managedCaddyPaths.registrationsDirectoryPath,
          managedCaddyPaths.routesDirectoryPath,
        );
      }
    }
  }
}

export function createInjectedServiceEnvironment(
  manifest: IResolvedDevhostManifest,
  service: IResolvedDevhostService,
): IInjectedServiceEnvironment {
  const environment: IInjectedServiceEnvironment = {
    DEVHOST_BIND_HOST: service.bindHost,
    DEVHOST_MANIFEST_PATH: manifest.manifestPath,
    DEVHOST_SERVICE_NAME: service.name,
  };

  if (service.port !== null) {
    environment.PORT = String(service.port);
  }

  if (service.host !== null) {
    environment.DEVHOST_HOST = service.host;
  }

  if (service.path !== null) {
    environment.DEVHOST_PATH = service.path;
  }

  return environment;
}

async function waitForAnyServiceExit(startedServices: StartedService[]): Promise<IServiceExitResult> {
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
    logger.info(
      `primary ${primaryService.name} -> http://${resolveProxyHost(primaryService.bindHost)}:${primaryService.port}`,
    );
  }
}
