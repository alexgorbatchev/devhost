import { describe, expect, test } from "bun:test";

import { managedCaddyPaths } from "../caddyPaths";
import { createLogger } from "../../utils/createLogger";
import {
  createManagedCaddyStartErrorMessage,
  runManagedCaddyLifecycleCommand,
} from "../runManagedCaddyLifecycleCommand";
import type { ICaddyCommandResult } from "../runManagedCaddyCommand";
import type { TestPromiseBoolean, TestPromiseVoid } from "../../utils/__tests__/testTypes";

interface ICaddyCommandCall {
  arguments_: string[];
  stdioMode: string | undefined;
}

const successfulCommandResult: ICaddyCommandResult = {
  stderr: new Uint8Array(),
  stdout: new Uint8Array(),
  success: true,
};

describe("runManagedCaddyLifecycleCommand", () => {
  test("starts managed caddy when the admin API is unavailable", async () => {
    const infoMessages: string[] = [];
    const caddyCommandCalls: ICaddyCommandCall[] = [];
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (message: string): void => {
        infoMessages.push(message);
      },
    });

    await expect(
      runManagedCaddyLifecycleCommand("start", logger, {
        ensureManagedCaddyConfig: (async (): Promise<void> => undefined) as TestPromiseVoid,
        hasManagedPidFile: (async (): Promise<boolean> => false) as TestPromiseBoolean,
        hasManagedRootCertificate: (async (): Promise<boolean> => false) as TestPromiseBoolean,
        isManagedCaddyAvailable: (async (): Promise<boolean> => false) as TestPromiseBoolean,
        runManagedCaddyCommand: (arguments_: string[], options): ICaddyCommandResult => {
          caddyCommandCalls.push({
            arguments_,
            stdioMode: options?.stdioMode,
          });
          return successfulCommandResult;
        },
      }),
    ).resolves.toBe(0);

    expect(caddyCommandCalls).toEqual([
      {
        arguments_: ["start", "--pidfile", managedCaddyPaths.pidFilePath],
        stdioMode: "inherit",
      },
    ]);
    expect(infoMessages).toEqual([
      "[devhost] managed caddy may prompt for your password on first start so it can install its local CA into the system trust store.",
      `[devhost] managed caddy started with ${managedCaddyPaths.caddyfilePath}`,
    ]);
  });

  test("refuses to start when a foreign caddy admin API is already listening", async () => {
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (): void => undefined,
    });

    await expect(
      runManagedCaddyLifecycleCommand("start", logger, {
        ensureManagedCaddyConfig: (async (): Promise<void> => undefined) as TestPromiseVoid,
        hasManagedPidFile: (async (): Promise<boolean> => false) as TestPromiseBoolean,
        isManagedCaddyAvailable: (async (): Promise<boolean> => true) as TestPromiseBoolean,
      }),
    ).rejects.toThrow(
      "A Caddy admin API is already listening on the devhost-managed address, but it was not started by devhost.",
    );
  });

  test("removes a stale pid file when stop is requested without a running caddy process", async () => {
    const infoMessages: string[] = [];
    const removedPidFiles: string[] = [];
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (message: string): void => {
        infoMessages.push(message);
      },
    });

    await expect(
      runManagedCaddyLifecycleCommand("stop", logger, {
        ensureManagedCaddyConfig: (async (): Promise<void> => undefined) as TestPromiseVoid,
        hasManagedPidFile: (async (): Promise<boolean> => true) as TestPromiseBoolean,
        isManagedCaddyAvailable: (async (): Promise<boolean> => false) as TestPromiseBoolean,
        removeManagedPidFile: (async (): Promise<void> => {
          removedPidFiles.push(managedCaddyPaths.pidFilePath);
        }) as TestPromiseVoid,
      }),
    ).resolves.toBe(0);

    expect(removedPidFiles).toEqual([managedCaddyPaths.pidFilePath]);
    expect(infoMessages).toEqual(["[devhost] managed caddy is not running. Removed the stale pid file."]);
  });

  test("explains privileged-port failures clearly", () => {
    const failingCommandResult: ICaddyCommandResult = {
      stderr: new TextEncoder().encode("listen tcp 127.0.0.1:443: bind: permission denied\n"),
      stdout: new Uint8Array(),
      success: false,
    };

    expect(createManagedCaddyStartErrorMessage(failingCommandResult, "darwin")).toBe(
      "Caddy start failed.\nlisten tcp 127.0.0.1:443: bind: permission denied\nmacOS allows rootless binds on :443 only with wildcard listeners, not loopback-specific ones.",
    );
    expect(createManagedCaddyStartErrorMessage(failingCommandResult, "linux")).toBe(
      "Caddy start failed.\nlisten tcp 127.0.0.1:443: bind: permission denied\nOpening HTTPS on :443 requires privileged-port setup on this platform.",
    );
  });

  test("downloads caddy when the download action is requested", async () => {
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (): void => undefined,
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "invalidos" });

    // We can test the integration by expecting the error from downloadCaddy
    await expect(
      runManagedCaddyLifecycleCommand("download", logger, {
        ensureManagedCaddyConfig: (async (): Promise<void> => undefined) as TestPromiseVoid,
      }),
    ).rejects.toThrow("Unsupported OS: invalidos");

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  test("warns before installing trust explicitly", async () => {
    const infoMessages: string[] = [];
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (message: string): void => {
        infoMessages.push(message);
      },
    });

    await expect(
      runManagedCaddyLifecycleCommand("trust", logger, {
        ensureManagedCaddyConfig: (async (): Promise<void> => undefined) as TestPromiseVoid,
        hasManagedPidFile: (async (): Promise<boolean> => true) as TestPromiseBoolean,
        isManagedCaddyAvailable: (async (): Promise<boolean> => false) as TestPromiseBoolean,
      }),
    ).rejects.toThrow("Managed Caddy is not running. Run 'devhost caddy start' first.");

    expect(infoMessages).toEqual([
      "[devhost] managed caddy trust may prompt for your password because installing a root CA into the system trust store is privileged.",
    ]);
  });

  test("requires a running managed caddy instance before trusting the local CA", async () => {
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (): void => undefined,
    });

    await expect(
      runManagedCaddyLifecycleCommand("trust", logger, {
        ensureManagedCaddyConfig: (async (): Promise<void> => undefined) as TestPromiseVoid,
        hasManagedPidFile: (async (): Promise<boolean> => true) as TestPromiseBoolean,
        isManagedCaddyAvailable: (async (): Promise<boolean> => false) as TestPromiseBoolean,
      }),
    ).rejects.toThrow("Managed Caddy is not running. Run 'devhost caddy start' first.");
  });
});
