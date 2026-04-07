import assert from "node:assert";

import { afterEach, describe, expect, test } from "bun:test";

import { waitForServiceHealth } from "../waitForServiceHealth";

interface ITestChildProcess {
  exitCode: number | null;
  exited: Promise<number>;
}

const servers: Array<Bun.Server<undefined>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      await server.stop(true);
    }),
  );
});

describe("waitForServiceHealth", () => {
  test("accepts process health checks when the child is still running", async () => {
    const childProcess: ITestChildProcess = createRunningChildProcess();

    await expect(
      waitForServiceHealth({
        childProcess,
        health: { kind: "process", interval: 200, timeout: 30000, retries: 0 },
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
    const serverPort: number | undefined = server.port;

    assert(serverPort !== undefined);
    servers.push(server);

    await expect(
      waitForServiceHealth({
        childProcess,
        health: {
          kind: "tcp",
          interval: 200,
          timeout: 30000,
          retries: 0,
          host: "127.0.0.1",
          port: serverPort,
        },
        serviceName: "web",
      }),
    ).resolves.toBeUndefined();
  });

  test("waits for an http health endpoint", async () => {
    const server = Bun.serve({
      fetch(): Response {
        return new Response("ok");
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    const childProcess: ITestChildProcess = createRunningChildProcess();
    const serverPort: number | undefined = server.port;

    assert(serverPort !== undefined);
    servers.push(server);

    await expect(
      waitForServiceHealth({
        childProcess,
        health: {
          kind: "http",
          interval: 200,
          timeout: 30000,
          retries: 0,
          url: `http://127.0.0.1:${serverPort}/healthz`,
        },
        serviceName: "api",
      }),
    ).resolves.toBeUndefined();
  });

  test("fails fast when the child exits before passing its health check", async () => {
    const childProcess: ITestChildProcess = {
      exitCode: 2,
      exited: Promise.resolve(2),
    };

    await expect(
      waitForServiceHealth({
        childProcess,
        health: {
          kind: "tcp",
          interval: 200,
          timeout: 30000,
          retries: 0,
          host: "127.0.0.1",
          port: 65534,
        },
        serviceName: "web",
      }),
    ).rejects.toThrow("Service web exited before passing its health check with code 2.");
  });
});

function createRunningChildProcess(): ITestChildProcess {
  return {
    exitCode: null,
    exited: new Promise<number>(() => {}),
  };
}
