import assert from "node:assert";

import { afterEach, describe, expect, test } from "bun:test";

import {
  collectManagedServicesHealth,
  type IManagedService,
  type IManagedSubprocess,
} from "../collectManagedServicesHealth";
import type { IResolvedDevhostService } from "../../types/stackTypes";

const servers: Array<Bun.Server<undefined>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server: Bun.Server<undefined>): Promise<void> => {
      await server.stop(true);
    }),
  );
});

describe("collectManagedServicesHealth", () => {
  test("returns live health for managed services", async () => {
    const tcpServer = Bun.serve({
      fetch(): Response {
        return new Response("ok");
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    const httpServer = Bun.serve({
      fetch(): Response {
        return new Response("ok");
      },
      hostname: "127.0.0.1",
      port: 0,
    });

    const tcpPort: number | undefined = tcpServer.port;
    const httpPort: number | undefined = httpServer.port;

    assert(tcpPort !== undefined);
    assert(httpPort !== undefined);
    servers.push(tcpServer, httpServer);

    const managedServices: IResolvedDevhostService[] = [
      createService({
        health: {
          host: "127.0.0.1",
          kind: "tcp",
          interval: 200,
          timeout: 30000,
          retries: 0,
          port: tcpPort,
        },
        name: "web",
        port: tcpPort,
      }),
      createService({
        health: {
          kind: "http",
          interval: 200,
          timeout: 30000,
          retries: 0,
          url: `http://127.0.0.1:${httpPort}/healthz`,
        },
        name: "api",
        port: httpPort,
      }),
      createService({
        health: {
          kind: "process",
          interval: 200,
          timeout: 30000,
          retries: 0,
        },
        host: null,
        name: "worker",
        port: null,
        portSource: "none",
      }),
      createService({
        health: {
          kind: "process",
          interval: 200,
          timeout: 30000,
          retries: 0,
        },
        host: null,
        name: "stopped-worker",
        port: null,
        portSource: "none",
      }),
      createService({
        health: {
          kind: "process",
          interval: 200,
          timeout: 30000,
          retries: 0,
        },
        host: null,
        name: "queued-worker",
        port: null,
        portSource: "none",
      }),
    ];
    const startedServices: IManagedService[] = [
      {
        childProcess: createRunningChildProcess(),
        service: managedServices[0],
      },
      {
        childProcess: createRunningChildProcess(),
        service: managedServices[1],
      },
      {
        childProcess: createRunningChildProcess(),
        service: managedServices[2],
      },
      {
        childProcess: createExitedChildProcess(2),
        service: managedServices[3],
      },
    ];

    await expect(collectManagedServicesHealth("hello-stack", managedServices, startedServices)).resolves.toEqual({
      services: [
        {
          name: "hello-stack",
          status: true,
        },
        {
          name: "web",
          status: true,
        },
        {
          name: "api",
          status: true,
        },
        {
          name: "worker",
          status: true,
        },
        {
          name: "stopped-worker",
          status: false,
        },
        {
          name: "queued-worker",
          status: false,
        },
      ],
    });
  });
});

function createRunningChildProcess(): IManagedSubprocess {
  return {
    exitCode: null,
    exited: new Promise<number>(() => {}),
  };
}

function createExitedChildProcess(exitCode: number): IManagedSubprocess {
  return {
    exitCode,
    exited: Promise.resolve(exitCode),
  };
}

function createService(overrides: Partial<IResolvedDevhostService>): IResolvedDevhostService {
  return {
    bindHost: "127.0.0.1",
    command: ["bun", "run", "dev"],
    cwd: "/tmp/project",
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
    host: "hello.local.test",
    path: "/",
    name: "web",
    port: 3200,
    portSource: "fixed",
    ...overrides,
  };
}
