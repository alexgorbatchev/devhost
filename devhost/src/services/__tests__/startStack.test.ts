import { describe, expect, test } from "bun:test";

import { createDefaultDevhostAgent } from "../../agents/createDefaultDevhostAgent";
import { createInjectedServiceEnvironment } from "../startStack";
import type { IResolvedDevhostManifest, IResolvedDevhostService } from "../../types/stackTypes";

describe("createInjectedServiceEnvironment", () => {
  test("injects manifest-mode variables for routed services without HOST", () => {
    const manifest: IResolvedDevhostManifest = {
      agent: createDefaultDevhostAgent(),
      devtools: true,
      devtoolsComponentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
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
        port: 3200,
      },
      host: "hello.xcv.lol",
      name: "web",
      port: 3200,
      portSource: "fixed",
    };

    expect(createInjectedServiceEnvironment(manifest, service)).toEqual({
      DEVHOST_BIND_HOST: "127.0.0.1",
      DEVHOST_HOST: "hello.xcv.lol",
      DEVHOST_MANIFEST_PATH: "/tmp/project/devhost.toml",
      DEVHOST_SERVICE_NAME: "web",
      DEVHOST_STACK: "hello-stack",
      PORT: "3200",
    });
  });

  test("omits routed-host and port variables when they are unavailable", () => {
    const manifest: IResolvedDevhostManifest = {
      agent: createDefaultDevhostAgent(),
      devtools: false,
      devtoolsComponentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
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
      },
      host: null,
      name: "worker",
      port: null,
      portSource: "none",
    };

    expect(createInjectedServiceEnvironment(manifest, service)).toEqual({
      DEVHOST_BIND_HOST: "127.0.0.1",
      DEVHOST_MANIFEST_PATH: "/tmp/project/devhost.toml",
      DEVHOST_SERVICE_NAME: "worker",
      DEVHOST_STACK: "hello-stack",
    });
  });
});
