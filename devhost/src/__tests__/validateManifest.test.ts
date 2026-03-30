import { describe, expect, test } from "bun:test";

import { validateManifest } from "../validateManifest";
import type { IValidatedDevhostManifest } from "../stackTypes";
import { getFixturePath, readFixtureToml } from "./testUtils";

describe("validateManifest", () => {
  test("returns a validated manifest with normalized defaults", async () => {
    const manifestValue: unknown = {
      name: "hello-stack",
      primaryService: "web",
      services: {
        web: {
          command: ["bun", "run", "dev"],
          port: 3000,
          publicHost: "hello.local.test",
        },
      },
    };
    const manifestPath: string = getFixturePath("basic-stack", "devhost.toml");
    const manifest: IValidatedDevhostManifest = validateManifest(manifestPath, manifestValue);

    expect(manifest.devtools).toBe(true);
    expect(manifest.services.web.bindHost).toBe("127.0.0.1");
    expect(manifest.services.web.cwd).toEndWith("basic-stack");
    expect(manifest.services.web.dependsOn).toEqual([]);
    expect(manifest.services.web.env).toEqual({});
    expect(manifest.services.web.publicHost).toBe("hello.local.test");
    expect(manifest.services.web.port).toBe(3000);
    expect(manifest.services.web.ready).toBeNull();
  });

  test("accepts the documented basic stack fixture", async () => {
    const manifestPath: string = getFixturePath("basic-stack", "devhost.toml");
    const manifestValue: unknown = await readFixtureToml("basic-stack", "devhost.toml");
    const manifest: IValidatedDevhostManifest = validateManifest(manifestPath, manifestValue);

    expect(manifest.devtools).toBe(true);
    expect(manifest.primaryService).toBe("web");
    expect(manifest.services.db.port).toBe("auto");
    expect(manifest.services.api.ready).toEqual({
      http: "http://127.0.0.1:4000/healthz",
    });
  });

  test("rejects syntactically invalid public hosts", async () => {
    const manifestPath: string = getFixturePath("invalid-public-host", "devhost.toml");
    const manifestValue: unknown = await readFixtureToml("invalid-public-host", "devhost.toml");

    expect(() => validateManifest(manifestPath, manifestValue)).toThrow(
      "services.web.publicHost must be a valid hostname",
    );
  });

  test("rejects explicit readiness when port is auto", async () => {
    const manifestPath: string = getFixturePath("invalid-auto-port-readiness", "devhost.toml");
    const manifestValue: unknown = await readFixtureToml("invalid-auto-port-readiness", "devhost.toml");

    expect(() => validateManifest(manifestPath, manifestValue)).toThrow(
      "services.db must omit ready when port = \"auto\" in v1.",
    );
  });

  test("rejects routed services without a port", () => {
    expect(() =>
      validateManifest("/tmp/devhost.toml", {
        name: "hello-stack",
        primaryService: "web",
        services: {
          web: {
            command: ["bun", "run", "dev"],
            publicHost: "hello.local.test",
          },
        },
      }),
    ).toThrow("services.web.publicHost requires services.web.port.");
  });

  test("rejects ready.process on routed services", () => {
    expect(() =>
      validateManifest("/tmp/devhost.toml", {
        name: "hello-stack",
        primaryService: "web",
        services: {
          web: {
            command: ["bun", "run", "dev"],
            port: 3000,
            publicHost: "hello.local.test",
            ready: {
              process: true,
            },
          },
        },
      }),
    ).toThrow("services.web must not use ready.process on a routed service.");
  });

  test("rejects duplicate fixed bind ports", () => {
    expect(() =>
      validateManifest("/tmp/devhost.toml", {
        name: "hello-stack",
        primaryService: "web",
        services: {
          api: {
            command: ["bun", "run", "api:dev"],
            port: 3000,
          },
          web: {
            command: ["bun", "run", "web:dev"],
            port: 3000,
          },
        },
      }),
    ).toThrow("services.web duplicates fixed bind port 127.0.0.1:3000.");
  });

  test("rejects cwd values that escape the manifest directory", () => {
    expect(() =>
      validateManifest("/tmp/project/devhost.toml", {
        name: "hello-stack",
        primaryService: "web",
        services: {
          web: {
            command: ["bun", "run", "dev"],
            cwd: "../outside",
            port: 3000,
          },
        },
      }),
    ).toThrow("services.web.cwd must stay within /tmp/project.");
  });
});
