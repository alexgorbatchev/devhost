import assert from "node:assert";

import { afterEach, describe, expect, test } from "bun:test";
import { clearLockedPorts } from "get-port";

import { resolveServicePorts } from "../resolveServicePorts";
import type { IResolvedDevhostManifest } from "../../types/stackTypes";
import { validateManifest } from "../../manifest/validateManifest";
import { getFixturePath, readFixtureToml } from "../../utils/__tests__/testUtils";

afterEach(() => {
  clearLockedPorts();
});

describe("resolveServicePorts", () => {
  test("resolves auto ports to unique runtime ports", async () => {
    const manifest = validateManifest(
      getFixturePath("basic-stack", "devhost.toml"),
      await readFixtureToml("basic-stack", "devhost.toml"),
    );
    const resolvedManifest: IResolvedDevhostManifest = await resolveServicePorts(manifest);

    expect(resolvedManifest.agent).toEqual({
      displayName: "Pi",
      kind: "pi",
    });
    expect(resolvedManifest.devtoolsComponentEditor).toBe("vscode");
    expect(resolvedManifest.devtoolsMinimapPosition).toBe("right");
    expect(resolvedManifest.devtoolsPosition).toBe("bottom-right");
    const databasePort: number | null = resolvedManifest.services.db.port;

    assert(databasePort !== null);
    expect(resolvedManifest.services.db.portSource).toBe("auto");
    expect(resolvedManifest.services.db.health).toEqual({
      kind: "tcp",
      host: "127.0.0.1",
      port: databasePort,
    });
    expect(databasePort).not.toBe(3000);
    expect(databasePort).not.toBe(4000);
  });

  test("treats different bind hosts as different runtime sockets", async () => {
    const manifest = validateManifest("/tmp/devhost.toml", {
      name: "hello-stack",
      primaryService: "web",
      services: {
        api: {
          command: ["bun", "run", "api:dev"],
          port: 3000,
        },
        web: {
          bindHost: "0.0.0.0",
          command: ["bun", "run", "web:dev"],
          health: {
            tcp: 3000,
          },
        },
      },
    });

    await expect(resolveServicePorts(manifest)).resolves.toBeDefined();
  });

  test("preserves explicit health checks, fixed ports, and configured agents", async () => {
    const manifest = validateManifest("/tmp/devhost.toml", {
      agent: {
        command: ["bun", "./scripts/devhost-agent.ts"],
        displayName: "Claude Code",
      },
      devtools: false,
      devtoolsComponentEditor: "webstorm",
      devtoolsMinimapPosition: "left",
      devtoolsPosition: "top-left",
      name: "hello-stack",
      primaryService: "api",
      services: {
        api: {
          command: ["bun", "run", "api:dev"],
          port: 4000,
          health: {
            http: "http://127.0.0.1:4000/healthz",
          },
        },
      },
    });
    const resolvedManifest: IResolvedDevhostManifest = await resolveServicePorts(manifest);

    expect(resolvedManifest.agent).toEqual({
      command: ["bun", "./scripts/devhost-agent.ts"],
      cwd: "/tmp",
      displayName: "Claude Code",
      env: {},
      kind: "configured",
    });
    expect(resolvedManifest.devtools).toBe(false);
    expect(resolvedManifest.devtoolsComponentEditor).toBe("webstorm");
    expect(resolvedManifest.devtoolsMinimapPosition).toBe("left");
    expect(resolvedManifest.devtoolsPosition).toBe("top-left");
    expect(resolvedManifest.services.api.port).toBe(4000);
    expect(resolvedManifest.services.api.portSource).toBe("fixed");
    expect(resolvedManifest.services.api.health).toEqual({
      kind: "http",
      url: "http://127.0.0.1:4000/healthz",
    });
  });
});
