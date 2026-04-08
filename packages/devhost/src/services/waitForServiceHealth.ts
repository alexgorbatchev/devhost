import { canConnectToPort, isReadyHttpEndpoint } from "../utils/networkUtils";
import { resolveProxyHost } from "../utils/resolveProxyHost";
import type { ResolvedHealthConfig } from "../types/stackTypes";

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
    throwIfExited(options.childProcess, options.serviceName);
    return;
  }

  const timeoutMs = options.health.timeout;
  const intervalMs = options.health.interval;
  const maxRetries = options.health.retries;

  let consecutiveFailures = 0;
  const deadline: number = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const isHealthy = await checkServiceHealth(options.health);

    if (isHealthy) {
      consecutiveFailures = 0;
      return;
    }

    consecutiveFailures++;

    // If we've made the minimum number of checks and exceeded allowed retries, fail early
    // Note: this only applies if the user specified retries. If 0 (default), it just polls until timeout.
    if (maxRetries > 0 && consecutiveFailures > maxRetries) {
      throw new Error(
        `Service ${options.serviceName} failed its health check ${consecutiveFailures} consecutive times.`,
      );
    }

    throwIfExited(options.childProcess, options.serviceName);
    await Bun.sleep(intervalMs);
  }

  throw new Error(`Service ${options.serviceName} did not pass its health check within ${timeoutMs}ms.`);
}

function throwIfExited(childProcess: ISubprocessLike, serviceName: string): void {
  if (childProcess.exitCode === null) {
    return;
  }

  throw new Error(`Service ${serviceName} exited before passing its health check with code ${childProcess.exitCode}.`);
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
