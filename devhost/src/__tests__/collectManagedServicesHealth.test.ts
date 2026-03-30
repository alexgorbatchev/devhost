import { afterEach, describe, expect, test } from "bun:test";

import {
  collectManagedServicesHealth,
  type IManagedService,
  type IManagedSubprocess,
} from "../collectManagedServicesHealth";
import type { IResolvedDevhostService } from "../stackTypes";

const servers: Bun.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server: Bun.Server): Promise<void> => {
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

    servers.push(tcpServer, httpServer);

    const managedServices: IResolvedDevhostService[] = [
      createService({
        health: {
          host: "127.0.0.1",
          kind: "tcp",
          port: tcpServer.port,
        },
        name: "web",
        port: tcpServer.port,
      }),
      createService({
        health: {
          kind: "http",
          url: `http://127.0.0.1:${httpServer.port}/healthz`,
        },
        name: "api",
        port: httpServer.port,
      }),
      createService({
        health: {
          kind: "process",
        },
        host: null,
        name: "worker",
        port: null,
        portSource: "none",
      }),
      createService({
        health: {
          kind: "process",
        },
        host: null,
        name: "stopped-worker",
        port: null,
        portSource: "none",
      }),
      createService({
        health: {
          kind: "process",
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

    await expect(collectManagedServicesHealth(managedServices, startedServices)).resolves.toEqual({
      services: [
        {
          name: "devhost",
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
      port: 3200,
    },
    host: "hello.local.test",
    name: "web",
    port: 3200,
    portSource: "fixed",
    ...overrides,
  };
}
