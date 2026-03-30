import { afterEach, describe, expect, test } from "bun:test";
import { clearLockedPorts } from "get-port";

import { resolveServicePorts } from "../resolveServicePorts";
import type { IResolvedDevhostManifest } from "../stackTypes";
import { validateManifest } from "../validateManifest";
import { getFixturePath, readFixtureToml } from "./testUtils";

afterEach(() => {
  clearLockedPorts();
});

describe("resolveServicePorts", () => {
  test("resolves auto ports to unique runtime ports", async () => {
    const manifest = validateManifest(getFixturePath("basic-stack", "devhost.toml"), await readFixtureToml("basic-stack", "devhost.toml"));
    const resolvedManifest: IResolvedDevhostManifest = await resolveServicePorts(manifest);

    expect(typeof resolvedManifest.services.db.port).toBe("number");
    expect(resolvedManifest.services.db.portSource).toBe("auto");
    expect(resolvedManifest.services.db.ready).toEqual({
      kind: "tcp",
      host: "127.0.0.1",
      port: resolvedManifest.services.db.port,
    });
    expect(resolvedManifest.services.db.port).not.toBe(3000);
    expect(resolvedManifest.services.db.port).not.toBe(4000);
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
          ready: {
            tcp: 3000,
          },
        },
      },
    });

    await expect(resolveServicePorts(manifest)).resolves.toBeDefined();
  });

  test("preserves explicit readiness and fixed ports", async () => {
    const manifest = validateManifest("/tmp/devhost.toml", {
      devtools: false,
      name: "hello-stack",
      primaryService: "api",
      services: {
        api: {
          command: ["bun", "run", "api:dev"],
          port: 4000,
          ready: {
            http: "http://127.0.0.1:4000/healthz",
          },
        },
      },
    });
    const resolvedManifest: IResolvedDevhostManifest = await resolveServicePorts(manifest);

    expect(resolvedManifest.devtools).toBe(false);
    expect(resolvedManifest.services.api.port).toBe(4000);
    expect(resolvedManifest.services.api.portSource).toBe("fixed");
    expect(resolvedManifest.services.api.ready).toEqual({
      kind: "http",
      url: "http://127.0.0.1:4000/healthz",
    });
  });
});
