import { describe, expect, test } from "bun:test";

import { createDefaultDevhostAgent } from "../../agents/createDefaultDevhostAgent";
import { createInjectedServiceEnvironment } from "../startStack";
import type { IResolvedDevhostManifest, IResolvedDevhostService } from "../../types/stackTypes";

describe("createInjectedServiceEnvironment", () => {
  test("injects manifest variables for routed services without HOST", () => {
    const manifest: IResolvedDevhostManifest = {
      agent: createDefaultDevhostAgent(),
      devtools: {
        editor: { enabled: true, ide: "vscode" },
        externalToolbars: { enabled: true },
        minimap: { enabled: true, position: "right" },
        status: { enabled: true, position: "bottom-right" },
      },
      manifestDirectoryPath: "/tmp/project",
      manifestPath: "/tmp/project/devhost.toml",
      name: "hello-stack",
      primaryService: "web",
      services: {},
    };
    const service: IResolvedDevhostService = {
      bindHost: "127.0.0.1",
      command: ["bun", "run", "dev"],
      cwd: "/tmp/project/app",
      dependsOn: [],
      env: {},
      health: {
        host: "127.0.0.1",
        kind: "tcp",
        interval: 200,
        timeout: 30000,
        retries: 0,
        port: 3200,
      },
      host: "hello.xcv.lol",
      path: "/",
      name: "web",
      port: 3200,
      portSource: "fixed",
    };

    expect(createInjectedServiceEnvironment(manifest, service)).toEqual({
      DEVHOST_BIND_HOST: "127.0.0.1",
      DEVHOST_HOST: "hello.xcv.lol",
      DEVHOST_PATH: "/",
      DEVHOST_MANIFEST_PATH: "/tmp/project/devhost.toml",
      DEVHOST_SERVICE_NAME: "web",
      PORT: "3200",
    });
  });

  test("omits routed-host and port variables when they are unavailable", () => {
    const manifest: IResolvedDevhostManifest = {
      agent: createDefaultDevhostAgent(),
      devtools: {
        editor: { enabled: false, ide: "vscode" },
        externalToolbars: { enabled: false },
        minimap: { enabled: false, position: "right" },
        status: { enabled: false, position: "bottom-right" },
      },
      manifestDirectoryPath: "/tmp/project",
      manifestPath: "/tmp/project/devhost.toml",
      name: "hello-stack",
      primaryService: "worker",
      services: {},
    };
    const service: IResolvedDevhostService = {
      bindHost: "127.0.0.1",
      command: ["bun", "run", "worker"],
      cwd: "/tmp/project/worker",
      dependsOn: [],
      env: {},
      health: {
        kind: "process",
        interval: 200,
        timeout: 30000,
        retries: 0,
      },
      host: null,
      path: null,
      name: "worker",
      port: null,
      portSource: "none",
    };

    expect(createInjectedServiceEnvironment(manifest, service)).toEqual({
      DEVHOST_BIND_HOST: "127.0.0.1",
      DEVHOST_MANIFEST_PATH: "/tmp/project/devhost.toml",
      DEVHOST_SERVICE_NAME: "worker",
    });
  });

  test("omits PORT when service injectPort is false", () => {
    const manifest: IResolvedDevhostManifest = {
      agent: createDefaultDevhostAgent(),
      devtools: {
        editor: { enabled: true, ide: "vscode" },
        externalToolbars: { enabled: true },
        minimap: { enabled: true, position: "right" },
        status: { enabled: true, position: "bottom-right" },
      },
      manifestDirectoryPath: "/tmp/project",
      manifestPath: "/tmp/project/devhost.toml",
      name: "hello-stack",
      primaryService: "web",
      services: {},
    };
    const service: IResolvedDevhostService = {
      bindHost: "127.0.0.1",
      command: ["bun", "run", "dev"],
      cwd: "/tmp/project/app",
      dependsOn: [],
      env: {},
      health: {
        host: "127.0.0.1",
        kind: "tcp",
        interval: 200,
        timeout: 30000,
        retries: 0,
        port: 3200,
      },
      host: "hello.xcv.lol",
      injectPort: false,
      path: "/",
      name: "web",
      port: 3200,
      portSource: "fixed",
    };

    expect(createInjectedServiceEnvironment(manifest, service)).toEqual({
      DEVHOST_BIND_HOST: "127.0.0.1",
      DEVHOST_HOST: "hello.xcv.lol",
      DEVHOST_PATH: "/",
      DEVHOST_MANIFEST_PATH: "/tmp/project/devhost.toml",
      DEVHOST_SERVICE_NAME: "web",
    });
  });
});
