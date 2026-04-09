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
  claimHost,
  cleanupStaleRegistrations,
  ensureCaddyAdminAvailable,
  releaseHostClaim,
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
import { claimFixedPort, cleanupStaleFixedPortClaims, releaseFixedPortClaim } from "./fixedPortClaims";
import { reassignAutoPort, shouldRetryAutoPortStartup } from "./autoPortRetryUtils";

const shutdownGracePeriodInMilliseconds: number = 10_000;

export interface IStartStackOptions {
  pipeServiceOutput?: boolean;
  stdinMode?: "ignore" | "inherit";
}

type StartedService = {
  childProcess: Bun.Subprocess;
  service: IResolvedDevhostService;
  isRestarting?: boolean;
};

type ClaimedFixedPort = {
  bindHost: string;
  port: number;
};

type ResolveAnyServiceExitCallback = (result: IServiceExitResult) => void;

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
  const claimedFixedPorts: ClaimedFixedPort[] = [];
  const claimedHosts: Set<string> = new Set<string>();
  const activeRoutes: Set<string> = new Set<string>();
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
  let cleanupError: unknown = null;
  let exitCode: number | null = null;
  let thrownError: unknown = null;
  let resolveSignal: SignalHandlerCallback | null = null;
  let resolveAnyServiceExit: ResolveAnyServiceExitCallback | null = null;
  const anyServiceExitPromise = new Promise<IServiceExitResult>((resolve) => {
    resolveAnyServiceExit = resolve;
  });
  const signalHandlers: ISignalHandlerRegistration[] = [];
  const signalPromise: Promise<SupportedSignal> = new Promise<SupportedSignal>((resolve) => {
    resolveSignal = resolve;
  });

  try {
    await ensureManagedCaddyConfig();
    await cleanupStaleRegistrations(managedCaddyPaths.registrationsDirectoryPath);
    await cleanupStaleFixedPortClaims(managedCaddyPaths.portClaimsDirectoryPath);
    await ensureCaddyAdminAvailable();

    for (const service of Object.values(manifest.services)) {
      if (service.portSource !== "fixed" || service.port === null) {
        continue;
      }

      await claimFixedPort({
        bindHost: service.bindHost,
        manifestPath: manifest.manifestPath,
        port: service.port,
        portClaimsDirectoryPath: managedCaddyPaths.portClaimsDirectoryPath,
      });
      claimedFixedPorts.push({
        bindHost: service.bindHost,
        port: service.port,
      });
    }

    for (const host of new Set(
      routedServices.flatMap((service: IResolvedDevhostService): string[] => {
        return service.host === null ? [] : [service.host];
      }),
    )) {
      await claimHost({
        host,
        manifestPath: manifest.manifestPath,
        registrationsDirectoryPath: managedCaddyPaths.registrationsDirectoryPath,
      });
      claimedHosts.add(host);
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
        restartService: async (serviceName: string) => {
          const startedService = startedServices.find((s) => s.service.name === serviceName);
          if (startedService) {
            if (startedService.isRestarting) {
              return;
            }
            startedService.isRestarting = true;
            await stopStartedService(startedService);
            removeStartedService(startedServices, startedService);
          }

          const newStartedService = await startServiceWithRetries(
            manifest,
            serviceName,
            logger,
            startedServices,
            devtoolsControlServer,
            resolvedOptions,
          );

          // Watch the new service
          void newStartedService.childProcess.exited.then((exitCode) => {
            if (!newStartedService.isRestarting) {
              resolveAnyServiceExit?.({ exitCode, serviceName: newStartedService.service.name });
            }
          });
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
      const startedService: StartedService = await startServiceWithRetries(
        manifest,
        serviceName,
        logger,
        startedServices,
        devtoolsControlServer,
        resolvedOptions,
      );
      const service: IResolvedDevhostService = startedService.service;

      void startedService.childProcess.exited.then((exitCode) => {
        if (!startedService.isRestarting) {
          resolveAnyServiceExit?.({ exitCode, serviceName: startedService.service.name });
        }
      });

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
            manifest.manifestPath,
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
            manifest.manifestPath,
            managedCaddyPaths.routesDirectoryPath,
          );
        }

        activeRoutes.add(service.name);
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
      anyServiceExitPromise.then(
        (result): IExitRaceResult => ({
          ...result,
          type: "exit",
        }),
      ),
    ]);

    if (raceResult.type === "signal") {
      exitCode = signalExitCodes[raceResult.signal];
    } else {
      exitCode = raceResult.exitCode;
    }
  } catch (error) {
    thrownError = error;

    if (receivedSignal !== null) {
      exitCode = signalExitCodes[receivedSignal];
      thrownError = null;
    }
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

    for (const serviceName of activeRoutes) {
      const activeService = routedServices.find(
        (service: IResolvedDevhostService): boolean => service.name === serviceName,
      );
      if (activeService?.host === null || activeService?.host === undefined) {
        continue;
      }

      try {
        await unregisterRoute(
          serviceName,
          activeService.host,
          activeService.path ?? "/",
          manifest.manifestPath,
          managedCaddyPaths.registrationsDirectoryPath,
        );
      } catch (error) {
        cleanupError ??= error;
      }
    }

    for (const host of claimedHosts) {
      try {
        await releaseHostClaim({
          host,
          manifestPath: manifest.manifestPath,
          registrationsDirectoryPath: managedCaddyPaths.registrationsDirectoryPath,
        });
      } catch (error) {
        cleanupError ??= error;
      }
    }

    for (const claimedFixedPort of claimedFixedPorts) {
      try {
        await releaseFixedPortClaim({
          bindHost: claimedFixedPort.bindHost,
          manifestPath: manifest.manifestPath,
          port: claimedFixedPort.port,
          portClaimsDirectoryPath: managedCaddyPaths.portClaimsDirectoryPath,
        });
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }

  if (cleanupError !== null && thrownError === null && receivedSignal === null) {
    thrownError = cleanupError;
  }

  if (thrownError !== null) {
    throw thrownError;
  }

  if (exitCode === null) {
    throw new Error("devhost exited without an exit code.");
  }

  return exitCode;
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

async function startServiceWithRetries(
  manifest: IResolvedDevhostManifest,
  serviceName: string,
  logger: IDevhostLogger,
  startedServices: StartedService[],
  devtoolsControlServer: Awaited<ReturnType<typeof startDevtoolsControlServer>> | null,
  options: Required<IStartStackOptions>,
): Promise<StartedService> {
  let retryCount: number = 0;

  while (true) {
    const service: IResolvedDevhostService = manifest.services[serviceName];
    const attemptOutputLines: string[] = [];
    const childEnvironment: Record<string, string | undefined> = {
      ...process.env,
      ...service.env,
      ...createInjectedServiceEnvironment(manifest, service),
    };
    const childProcess = options.pipeServiceOutput
      ? Bun.spawn(service.command, {
          cwd: service.cwd,
          env: childEnvironment,
          stderr: "pipe",
          stdin: options.stdinMode,
          stdout: "pipe",
        })
      : Bun.spawn(service.command, {
          cwd: service.cwd,
          env: childEnvironment,
          stderr: "inherit",
          stdin: options.stdinMode,
          stdout: "inherit",
        });
    const startedService: StartedService = {
      childProcess,
      service,
    };

    startedServices.push(startedService);
    void childProcess.exited.then(async (): Promise<void> => {
      await devtoolsControlServer?.publishHealthResponse();
    });
    await devtoolsControlServer?.publishHealthResponse();

    const outputPumpPromises: Promise<void>[] = [];

    if (options.pipeServiceOutput) {
      const stdoutPumpPromise: Promise<void> = pipeSubprocessOutput(
        childProcess.stdout,
        `[${service.name}] `,
        (line: string) => {
          appendAttemptOutputLine(attemptOutputLines, line);
          devtoolsControlServer?.publishLogEntry(service.name, "stdout", line);
          console.log(line);
        },
      );
      const stderrPumpPromise: Promise<void> = pipeSubprocessOutput(
        childProcess.stderr,
        `[${service.name}] `,
        (line: string) => {
          appendAttemptOutputLine(attemptOutputLines, line);
          devtoolsControlServer?.publishLogEntry(service.name, "stderr", line);
          console.error(line);
        },
      );

      void stdoutPumpPromise.catch(() => undefined);
      void stderrPumpPromise.catch(() => undefined);
      outputPumpPromises.push(stdoutPumpPromise, stderrPumpPromise);
    }

    try {
      await waitForServiceHealth({
        childProcess,
        health: service.health,
        serviceName,
      });
      await devtoolsControlServer?.publishHealthResponse();
      return startedService;
    } catch (error) {
      removeStartedService(startedServices, startedService);
      await stopStartedService(startedService);
      await Promise.allSettled(outputPumpPromises);
      await devtoolsControlServer?.publishHealthResponse();

      if (!shouldRetryAutoPortStartup(service, error, attemptOutputLines, retryCount)) {
        throw error;
      }

      retryCount += 1;
      logger.info(`retrying ${service.name} with a new auto port after a bind collision.`);
      await reassignAutoPort(manifest, serviceName);
    }
  }
}

function appendAttemptOutputLine(outputLines: string[], line: string): void {
  outputLines.push(line);

  if (outputLines.length > 50) {
    outputLines.shift();
  }
}

function removeStartedService(startedServices: StartedService[], targetStartedService: StartedService): void {
  const targetIndex: number = startedServices.indexOf(targetStartedService);

  if (targetIndex === -1) {
    return;
  }

  startedServices.splice(targetIndex, 1);
}

async function stopStartedService(startedService: StartedService): Promise<void> {
  const { childProcess } = startedService;

  if (childProcess.exitCode !== null) {
    await childProcess.exited;
    return;
  }

  if (!childProcess.killed) {
    childProcess.kill("SIGTERM");
  }

  const didExitGracefully: boolean = await waitForExitWithinGracePeriod(childProcess);

  if (didExitGracefully) {
    return;
  }

  if (!childProcess.killed && childProcess.exitCode === null) {
    childProcess.kill("SIGKILL");
  }

  await childProcess.exited;
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
