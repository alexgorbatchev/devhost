import { pollIntervalInMilliseconds, startupTimeoutInMilliseconds } from "./constants";
import { canConnectToPort, isReadyHttpEndpoint } from "./networkUtils";
import { resolveProxyHost } from "./resolveProxyHost";
import type { ResolvedHealthConfig } from "./stackTypes";

interface ISubprocessLike {
  exitCode: number | null;
  exited: Promise<number>;
}

interface IWaitForServiceHealthOptions {
  childProcess: ISubprocessLike;
  health: ResolvedHealthConfig;
  serviceName: string;
}

export async function waitForServiceHealth(options: IWaitForServiceHealthOptions): Promise<void> {
  if (options.health.kind === "process") {
    await throwIfExited(options.childProcess, options.serviceName);
    return;
  }

  const deadline: number = Date.now() + startupTimeoutInMilliseconds;

  while (Date.now() < deadline) {
    if (await checkServiceHealth(options.health)) {
      return;
    }

    await throwIfExited(options.childProcess, options.serviceName);
    await Bun.sleep(pollIntervalInMilliseconds);
  }

  throw new Error(
    `Service ${options.serviceName} did not pass its health check within ${startupTimeoutInMilliseconds}ms.`,
  );
}

async function throwIfExited(childProcess: ISubprocessLike, serviceName: string): Promise<void> {
  if (childProcess.exitCode === null) {
    return;
  }

  const exitCode: number = await childProcess.exited;
  throw new Error(`Service ${serviceName} exited before passing its health check with code ${exitCode}.`);
}

export async function checkServiceHealth(health: ResolvedHealthConfig): Promise<boolean> {
  if (health.kind === "process") {
    return true;
  }

  if (health.kind === "tcp") {
    return await canConnectToPort(resolveProxyHost(health.host), health.port);
  }

  return await isReadyHttpEndpoint(health.url);
}
