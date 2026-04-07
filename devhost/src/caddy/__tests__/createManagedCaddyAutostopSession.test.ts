import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createManagedCaddyPaths } from "../caddyPaths";
import {
  assertManagedCaddyAutostopIsAvailable,
  createManagedCaddyAutostopSession,
} from "../createManagedCaddyAutostopSession";
import { ensureManagedCaddyConfig } from "../ensureManagedCaddyConfig";
import { createLogger } from "../../utils/createLogger";

const temporaryDirectoryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectoryPaths.map(async (temporaryDirectoryPath: string): Promise<void> => {
      await rm(temporaryDirectoryPath, { force: true, recursive: true });
    }),
  );
  temporaryDirectoryPaths.length = 0;
});

describe("createManagedCaddyAutostopSession", () => {
  test("starts managed caddy, writes the autostop lock, and stops on release", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-caddy-autostop-"));
    const lifecycleActions: string[] = [];
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (): void => undefined,
    });

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);

    const session = await createManagedCaddyAutostopSession(
      {
        manifestPath: "/tmp/project/devhost.toml",
        stackName: "hello-stack",
      },
      logger,
      {
        paths,
        runManagedCaddyLifecycleCommand: async (action): Promise<number> => {
          lifecycleActions.push(action);
          return 0;
        },
      },
    );

    const lockContents: string = await readFile(paths.autostopLockFilePath, "utf8");

    expect(JSON.parse(lockContents)).toMatchObject({
      manifestPath: "/tmp/project/devhost.toml",
      ownerPid: process.pid,
      stackName: "hello-stack",
    });
    expect(lifecycleActions).toEqual(["start"]);

    await session.release();

    expect(lifecycleActions).toEqual(["start", "stop"]);
    await expect(access(paths.autostopLockFilePath)).rejects.toThrow();
  });

  test("rejects a live autostop lock owned by another process", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-caddy-autostop-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);
    await writeFile(
      paths.autostopLockFilePath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          manifestPath: "/tmp/other/devhost.toml",
          ownerPid: 4_321,
          stackName: "other-stack",
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      assertManagedCaddyAutostopIsAvailable({
        isProcessAlive: (processId: number): boolean => processId === 4_321,
        paths,
      }),
    ).rejects.toThrow(
      "Managed Caddy autostop is already owned by PID 4321.\nstack: other-stack\nmanifest: /tmp/other/devhost.toml\nStop the other devhost instance first, or disable [caddy].autostop.",
    );
  });

  test("removes a stale autostop lock left by a dead process", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-caddy-autostop-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);
    await writeFile(
      paths.autostopLockFilePath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          manifestPath: "/tmp/other/devhost.toml",
          ownerPid: 4_321,
          stackName: "other-stack",
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      assertManagedCaddyAutostopIsAvailable({
        isProcessAlive: (): boolean => false,
        paths,
      }),
    ).resolves.toBeUndefined();
    await expect(access(paths.autostopLockFilePath)).rejects.toThrow();
  });

  test("rejects autostop when another routed devhost registration is still active", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-caddy-autostop-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);
    const logger = createLogger({
      errorSink: (): void => undefined,
      infoSink: (): void => undefined,
    });

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);
    await writeFile(
      join(paths.registrationsDirectoryPath, "hello.local.test.json"),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          host: "hello.local.test",
          ownerPid: 4_321,
          port: 3_000,
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      createManagedCaddyAutostopSession(
        {
          manifestPath: "/tmp/project/devhost.toml",
          stackName: "hello-stack",
        },
        logger,
        {
          isProcessAlive: (processId: number): boolean => processId === 4_321,
          paths,
          runManagedCaddyLifecycleCommand: async (): Promise<number> => 0,
        },
      ),
    ).rejects.toThrow(
      "Cannot enable [caddy].autostop while hello.local.test is claimed by PID 4321 on port 3000. Stop the other devhost instance first.",
    );
  });
});
