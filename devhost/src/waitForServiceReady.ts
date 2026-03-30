import { pollIntervalInMilliseconds, startupTimeoutInMilliseconds } from "./constants";
import { canConnectToPort, isReadyHttpEndpoint } from "./networkUtils";
import { resolveProxyHost } from "./resolveProxyHost";
import type { ResolvedReadyConfig } from "./stackTypes";

interface ISubprocessLike {
  exitCode: number | null;
  exited: Promise<number>;
}

interface IWaitForServiceReadyOptions {
  childProcess: ISubprocessLike;
  ready: ResolvedReadyConfig;
  serviceName: string;
}

export async function waitForServiceReady(options: IWaitForServiceReadyOptions): Promise<void> {
  if (options.ready.kind === "process") {
    await throwIfExited(options.childProcess, options.serviceName);
    return;
  }

  const deadline: number = Date.now() + startupTimeoutInMilliseconds;

  while (Date.now() < deadline) {
    if (await isServiceReady(options.ready)) {
      return;
    }

    await throwIfExited(options.childProcess, options.serviceName);
    await Bun.sleep(pollIntervalInMilliseconds);
  }

  throw new Error(
    `Service ${options.serviceName} did not become ready within ${startupTimeoutInMilliseconds}ms.`,
  );
}

async function throwIfExited(childProcess: ISubprocessLike, serviceName: string): Promise<void> {
  if (childProcess.exitCode === null) {
    return;
  }

  const exitCode: number = await childProcess.exited;
  throw new Error(`Service ${serviceName} exited before readiness with code ${exitCode}.`);
}

async function isServiceReady(ready: ResolvedReadyConfig): Promise<boolean> {
  if (ready.kind === "tcp") {
    return await canConnectToPort(resolveProxyHost(ready.host), ready.port);
  }

  return await isReadyHttpEndpoint(ready.url);
}
