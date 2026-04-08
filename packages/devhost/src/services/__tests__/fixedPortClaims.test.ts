import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createManagedCaddyPaths } from "../../caddy/caddyPaths";
import { ensureManagedCaddyConfig } from "../../caddy/ensureManagedCaddyConfig";
import {
  claimFixedPort,
  cleanupStaleFixedPortClaims,
  createFixedPortClaimText,
  releaseFixedPortClaim,
} from "../fixedPortClaims";

const temporaryDirectoryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectoryPaths.map(async (temporaryDirectoryPath: string): Promise<void> => {
      await rm(temporaryDirectoryPath, { force: true, recursive: true });
    }),
  );
  temporaryDirectoryPaths.length = 0;
});

describe("fixedPortClaims", () => {
  test("claims and releases a fixed bind port", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-fixed-port-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);

    await claimFixedPort({
      bindHost: "127.0.0.1",
      manifestPath: "/tmp/project/devhost.toml",
      port: 3000,
      portClaimsDirectoryPath: paths.portClaimsDirectoryPath,
    });

    const claimText: string = await readFile(join(paths.portClaimsDirectoryPath, "ipv4_3000.json"), "utf8");

    expect(claimText).toContain('"manifestPath": "/tmp/project/devhost.toml"');

    await releaseFixedPortClaim({
      bindHost: "127.0.0.1",
      manifestPath: "/tmp/project/devhost.toml",
      port: 3000,
      portClaimsDirectoryPath: paths.portClaimsDirectoryPath,
    });

    await expect(readFile(join(paths.portClaimsDirectoryPath, "ipv4_3000.json"), "utf8")).rejects.toThrow();
  });

  test("rejects a live fixed bind port claim from another process", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-fixed-port-live-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);
    await writeFile(
      join(paths.portClaimsDirectoryPath, "ipv4_3000.json"),
      JSON.stringify(
        {
          bindHost: "127.0.0.1",
          createdAt: new Date().toISOString(),
          manifestPath: "/tmp/other/devhost.toml",
          ownerPid: process.pid,
          port: 3000,
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      claimFixedPort({
        bindHost: "127.0.0.1",
        manifestPath: "/tmp/project/devhost.toml",
        port: 3000,
        portClaimsDirectoryPath: paths.portClaimsDirectoryPath,
      }),
    ).rejects.toThrow("Fixed bind port 127.0.0.1:3000 is already claimed");
  });

  test("rejects overlapping fixed bind port claims for wildcard and loopback hosts", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-fixed-port-overlap-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);

    await claimFixedPort({
      bindHost: "0.0.0.0",
      manifestPath: "/tmp/project/devhost.toml",
      port: 3000,
      portClaimsDirectoryPath: paths.portClaimsDirectoryPath,
    });

    await expect(
      claimFixedPort({
        bindHost: "127.0.0.1",
        manifestPath: "/tmp/other/devhost.toml",
        port: 3000,
        portClaimsDirectoryPath: paths.portClaimsDirectoryPath,
      }),
    ).rejects.toThrow("Fixed bind port 127.0.0.1:3000 is already claimed");
  });

  test("removes stale fixed bind port claims", async () => {
    const temporaryDirectoryPath: string = await mkdtemp(join(tmpdir(), "devhost-fixed-port-stale-"));
    const paths = createManagedCaddyPaths(temporaryDirectoryPath);

    temporaryDirectoryPaths.push(temporaryDirectoryPath);
    await ensureManagedCaddyConfig(paths);
    await writeFile(
      join(paths.portClaimsDirectoryPath, "ipv4_3000.json"),
      createFixedPortClaimText("127.0.0.1", "/tmp/project/devhost.toml", 3000).replace(
        `"ownerPid": ${process.pid}`,
        '"ownerPid": 999999',
      ),
      "utf8",
    );

    await cleanupStaleFixedPortClaims(paths.portClaimsDirectoryPath);

    await expect(readFile(join(paths.portClaimsDirectoryPath, "ipv4_3000.json"), "utf8")).rejects.toThrow();
  });
});
