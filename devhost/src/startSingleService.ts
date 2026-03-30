import { defaultBindHost, signalExitCodes, supportedSignals, type SupportedSignal } from "./constants";
import type { IDevhostLogger } from "./createLogger";
import type { ISingleServiceCommandLineArguments } from "./parseCommandLineArguments";
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
import { startDevtoolsControlServer } from "./startDevtoolsControlServer";
import { startDocumentInjectionServer } from "./startDocumentInjectionServer";
import { waitForServiceHealth } from "./waitForServiceHealth";

export function createSingleServiceEnvironment(
  arguments_: ISingleServiceCommandLineArguments,
): Record<string, string | undefined> {
  return {
    DEVHOST_BIND_HOST: defaultBindHost,
    DEVHOST_HOST: arguments_.host,
    PORT: String(arguments_.port),
  };
}

export async function startSingleService(
  arguments_: ISingleServiceCommandLineArguments,
  logger: IDevhostLogger,
): Promise<number> {
  let childProcess: Bun.Subprocess | null = null;
  let devtoolsControlServer: Awaited<ReturnType<typeof startDevtoolsControlServer>> | null = null;
  let documentInjectionServer: ReturnType<typeof startDocumentInjectionServer> | null = null;
  let receivedSignal: SupportedSignal | null = null;
  let isRegistered: boolean = false;

  try {
    await ensureRouteDirectories();
    await ensureCaddyfileExists();
    await cleanupStaleRegistrations();
    await ensureCaddyAdminAvailable();
    await claimRegistration(arguments_.host, arguments_.port);

    const childEnvironment: Record<string, string | undefined> = {
      ...process.env,
      ...createSingleServiceEnvironment(arguments_),
    };

    childProcess = Bun.spawn(arguments_.command, {
      cwd: process.cwd(),
      env: childEnvironment,
      stderr: "inherit",
      stdin: "inherit",
      stdout: "inherit",
    });

    for (const signalName of supportedSignals) {
      process.on(signalName, () => {
        receivedSignal = signalName;

        if (childProcess !== null && !childProcess.killed) {
          childProcess.kill(signalName);
        }
      });
    }

    await waitForServiceHealth({
      childProcess,
      health: {
        kind: "tcp",
        host: defaultBindHost,
        port: arguments_.port,
      },
      serviceName: arguments_.host,
    });

    devtoolsControlServer = await startDevtoolsControlServer();
    documentInjectionServer = startDocumentInjectionServer({
      backendHost: defaultBindHost,
      backendPort: arguments_.port,
    });

    await activateRoute({
      appBindHost: defaultBindHost,
      appPort: arguments_.port,
      devtoolsControlPort: devtoolsControlServer.port,
      documentInjectionPort: documentInjectionServer.port,
      host: arguments_.host,
    });
    isRegistered = true;
    logger.info(
      `registered https://${arguments_.host} -> app:${arguments_.port}, control:${devtoolsControlServer.port}, document:${documentInjectionServer.port}`,
    );

    const exitCode: number = await childProcess.exited;

    if (receivedSignal !== null) {
      return signalExitCodes[receivedSignal];
    }

    return exitCode;
  } catch (error) {
    if (childProcess !== null && childProcess.exitCode === null && !childProcess.killed) {
      childProcess.kill("SIGTERM");
      await childProcess.exited;
    }

    throw error;
  } finally {
    if (isRegistered) {
      await unregisterRoute(arguments_.host);
      logger.info(`removed https://${arguments_.host}`);
    } else {
      await removeRouteFiles(arguments_.host);
    }

    if (documentInjectionServer !== null) {
      await documentInjectionServer.stop();
    }

    if (devtoolsControlServer !== null) {
      await devtoolsControlServer.stop();
    }
  }
}
