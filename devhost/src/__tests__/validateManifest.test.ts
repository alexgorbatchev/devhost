import { describe, expect, test } from "bun:test";

import type { IValidatedDevhostManifest } from "../stackTypes";
import { validateManifest } from "../validateManifest";
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
          host: "hello.local.test",
        },
      },
    };
    const manifestPath: string = getFixturePath("basic-stack", "devhost.toml");
    const manifest: IValidatedDevhostManifest = validateManifest(manifestPath, manifestValue);

    expect(manifest.agent).toEqual({
      displayName: "Pi",
      kind: "pi",
    });
    expect(manifest.devtools).toBe(true);
    expect(manifest.devtoolsComponentEditor).toBe("vscode");
    expect(manifest.devtoolsMinimapPosition).toBe("right");
    expect(manifest.devtoolsPosition).toBe("bottom-right");
    expect(manifest.services.web.bindHost).toBe("127.0.0.1");
    expect(manifest.services.web.cwd).toEndWith("basic-stack");
    expect(manifest.services.web.dependsOn).toEqual([]);
    expect(manifest.services.web.env).toEqual({});
    expect(manifest.services.web.host).toBe("hello.local.test");
    expect(manifest.services.web.port).toBe(3000);
    expect(manifest.services.web.health).toBeNull();
  });

  test("accepts the documented basic stack fixture", async () => {
    const manifestPath: string = getFixturePath("basic-stack", "devhost.toml");
    const manifestValue: unknown = await readFixtureToml("basic-stack", "devhost.toml");
    const manifest: IValidatedDevhostManifest = validateManifest(manifestPath, manifestValue);

    expect(manifest.agent).toEqual({
      displayName: "Pi",
      kind: "pi",
    });
    expect(manifest.devtools).toBe(true);
    expect(manifest.devtoolsComponentEditor).toBe("vscode");
    expect(manifest.devtoolsMinimapPosition).toBe("right");
    expect(manifest.devtoolsPosition).toBe("bottom-right");
    expect(manifest.primaryService).toBe("web");
    expect(manifest.services.db.port).toBe("auto");
    expect(manifest.services.api.health).toEqual({
      http: "http://127.0.0.1:4000/healthz",
    });
  });

  test("accepts a built-in claude-code agent adapter", () => {
    const manifest: IValidatedDevhostManifest = validateManifest("/tmp/devhost.toml", {
      agent: {
        adapter: "claude-code",
      },
      name: "hello-stack",
      primaryService: "web",
      services: {
        web: {
          command: ["bun", "run", "dev"],
          port: 3000,
        },
      },
    });

    expect(manifest.agent).toEqual({
      displayName: "Claude Code",
      kind: "claude-code",
    });
  });

  test("accepts explicit devtools UI positions, component editor, and a configured agent", () => {
    const manifest: IValidatedDevhostManifest = validateManifest("/tmp/devhost.toml", {
      agent: {
        command: ["bun", "./scripts/devhost-agent.ts"],
        cwd: ".",
        displayName: "Claude Code",
        env: {
          DEVHOST_AGENT_MODE: "annotation",
        },
      },
      devtoolsComponentEditor: "neovim",
      devtoolsMinimapPosition: "left",
      devtoolsPosition: "top-left",
      name: "hello-stack",
      primaryService: "web",
      services: {
        web: {
          command: ["bun", "run", "dev"],
          port: 3000,
        },
      },
    });

    expect(manifest.agent).toEqual({
      command: ["bun", "./scripts/devhost-agent.ts"],
      cwd: "/tmp",
      displayName: "Claude Code",
      env: {
        DEVHOST_AGENT_MODE: "annotation",
      },
      kind: "configured",
    });
    expect(manifest.devtoolsComponentEditor).toBe("neovim");
    expect(manifest.devtoolsMinimapPosition).toBe("left");
    expect(manifest.devtoolsPosition).toBe("top-left");
  });

  test("rejects a configured agent cwd that escapes the manifest directory", () => {
    expect(() =>
      validateManifest("/tmp/project/devhost.toml", {
        agent: {
          command: ["bun", "./scripts/devhost-agent.ts"],
          cwd: "../outside",
          displayName: "Claude Code",
        },
        name: "hello-stack",
        primaryService: "web",
        services: {
          web: {
            command: ["bun", "run", "dev"],
            port: 3000,
          },
        },
      }),
    ).toThrow("agent.cwd must stay within /tmp/project.");
  });

  test("rejects syntactically invalid public hosts", async () => {
    const manifestPath: string = getFixturePath("invalid-public-host", "devhost.toml");
    const manifestValue: unknown = await readFixtureToml("invalid-public-host", "devhost.toml");

    expect(() => validateManifest(manifestPath, manifestValue)).toThrow("services.web.host must be a valid hostname");
  });

  test("rejects explicit health checks when port is auto", async () => {
    const manifestPath: string = getFixturePath("invalid-auto-port-health", "devhost.toml");
    const manifestValue: unknown = await readFixtureToml("invalid-auto-port-health", "devhost.toml");

    expect(() => validateManifest(manifestPath, manifestValue)).toThrow(
      'services.db must omit health when port = "auto" in v1.',
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
            host: "hello.local.test",
          },
        },
      }),
    ).toThrow("services.web.host requires services.web.port.");
  });

  test("rejects health.process on routed services", () => {
    expect(() =>
      validateManifest("/tmp/devhost.toml", {
        name: "hello-stack",
        primaryService: "web",
        services: {
          web: {
            command: ["bun", "run", "dev"],
            port: 3000,
            host: "hello.local.test",
            health: {
              process: true,
            },
          },
        },
      }),
    ).toThrow("services.web must not use health.process on a routed service.");
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
