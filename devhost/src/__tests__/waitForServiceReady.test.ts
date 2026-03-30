import { afterEach, describe, expect, test } from "bun:test";

import { waitForServiceReady } from "../waitForServiceReady";

interface ITestChildProcess {
  exitCode: number | null;
  exited: Promise<number>;
}

const servers: Bun.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      await server.stop(true);
    }),
  );
});

describe("waitForServiceReady", () => {
  test("accepts process readiness when the child is still running", async () => {
    const childProcess: ITestChildProcess = createRunningChildProcess();

    await expect(
      waitForServiceReady({
        childProcess,
        ready: { kind: "process" },
        serviceName: "worker",
      }),
    ).resolves.toBeUndefined();
  });

  test("waits for a tcp port to accept connections", async () => {
    const server = Bun.serve({
      fetch(): Response {
        return new Response("ok");
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    const childProcess: ITestChildProcess = createRunningChildProcess();

    servers.push(server);

    await expect(
      waitForServiceReady({
        childProcess,
        ready: {
          kind: "tcp",
          host: "127.0.0.1",
          port: server.port,
        },
        serviceName: "web",
      }),
    ).resolves.toBeUndefined();
  });

  test("waits for an http readiness endpoint", async () => {
    const server = Bun.serve({
      fetch(): Response {
        return new Response("ok");
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    const childProcess: ITestChildProcess = createRunningChildProcess();

    servers.push(server);

    await expect(
      waitForServiceReady({
        childProcess,
        ready: {
          kind: "http",
          url: `http://127.0.0.1:${server.port}/healthz`,
        },
        serviceName: "api",
      }),
    ).resolves.toBeUndefined();
  });

  test("fails fast when the child exits before readiness", async () => {
    const childProcess: ITestChildProcess = {
      exitCode: 2,
      exited: Promise.resolve(2),
    };

    await expect(
      waitForServiceReady({
        childProcess,
        ready: {
          kind: "tcp",
          host: "127.0.0.1",
          port: 65534,
        },
        serviceName: "web",
      }),
    ).rejects.toThrow("Service web exited before readiness with code 2.");
  });
});

function createRunningChildProcess(): ITestChildProcess {
  return {
    exitCode: null,
    exited: new Promise<number>(() => {}),
  };
}
