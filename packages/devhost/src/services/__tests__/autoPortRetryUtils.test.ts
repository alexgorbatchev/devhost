import assert from "node:assert";

import { afterEach, describe, expect, test } from "bun:test";
import { clearLockedPorts } from "get-port";

import { createDefaultDevhostAgent } from "../../agents/createDefaultDevhostAgent";
import { reassignAutoPort, shouldRetryAutoPortStartup } from "../autoPortRetryUtils";
import type { IResolvedDevhostManifest, IResolvedDevhostService } from "../../types/stackTypes";

afterEach(() => {
  clearLockedPorts();
});

describe("shouldRetryAutoPortStartup", () => {
  test("retries clear bind collisions for auto-port services", () => {
    const service: IResolvedDevhostService = createAutoPortService();

    expect(
      shouldRetryAutoPortStartup(service, new Error("Service api exited before passing its health check with code 1."), [
        "[api] Error: listen EADDRINUSE: address already in use 127.0.0.1:3000",
      ], 0),
    ).toBe(true);
  });

  test("does not retry after the retry budget is exhausted", () => {
    const service: IResolvedDevhostService = createAutoPortService();

    expect(
      shouldRetryAutoPortStartup(service, new Error("listen EADDRINUSE"), ["address already in use"], 3),
    ).toBe(false);
  });

  test("does not retry non-auto services", () => {
    const service: IResolvedDevhostService = {
      ...createAutoPortService(),
      port: 3000,
      portSource: "fixed",
    };

    expect(shouldRetryAutoPortStartup(service, new Error("listen EADDRINUSE"), ["address already in use"], 0)).toBe(
      false,
    );
  });
});

describe("reassignAutoPort", () => {
  test("picks a replacement port and updates the service health check", async () => {
    const manifest: IResolvedDevhostManifest = {
      agent: createDefaultDevhostAgent(),
      devtools: {
        editor: { enabled: true, ide: "vscode" },
        minimap: { enabled: true, position: "right" },
        status: { enabled: true, position: "bottom-right" },
      },
      manifestDirectoryPath: "/tmp/project",
      manifestPath: "/tmp/project/devhost.toml",
      name: "hello-stack",
      primaryService: "web",
      services: {
        api: {
          bindHost: "127.0.0.1",
          command: ["bun", "run", "api:dev"],
          cwd: "/tmp/project",
          dependsOn: [],
          env: {},
          health: {
            host: "127.0.0.1",
            interval: 200,
            kind: "tcp",
            port: 3200,
            retries: 0,
            timeout: 30_000,
          },
          host: null,
          name: "api",
          path: null,
          port: 3200,
          portSource: "auto",
        },
        web: {
          bindHost: "127.0.0.1",
          command: ["bun", "run", "web:dev"],
          cwd: "/tmp/project",
          dependsOn: [],
          env: {},
          health: {
            host: "127.0.0.1",
            interval: 200,
            kind: "tcp",
            port: 3000,
            retries: 0,
            timeout: 30_000,
          },
          host: null,
          name: "web",
          path: null,
          port: 3000,
          portSource: "fixed",
        },
      },
    };

    const updatedService: IResolvedDevhostService = await reassignAutoPort(manifest, "api");

    assert(updatedService.port !== null);
    expect(updatedService.port).not.toBe(3000);
    expect(updatedService.port).not.toBe(3200);
    expect(updatedService.health).toEqual({
      host: "127.0.0.1",
      interval: 200,
      kind: "tcp",
      port: updatedService.port,
      retries: 0,
      timeout: 30_000,
    });
  });
});

function createAutoPortService(): IResolvedDevhostService {
  return {
    bindHost: "127.0.0.1",
    command: ["bun", "run", "api:dev"],
    cwd: "/tmp/project",
    dependsOn: [],
    env: {},
    health: {
      host: "127.0.0.1",
      interval: 200,
      kind: "tcp",
      port: 3200,
      retries: 0,
      timeout: 30_000,
    },
    host: null,
    name: "api",
    path: null,
    port: 3200,
    portSource: "auto",
  };
}
