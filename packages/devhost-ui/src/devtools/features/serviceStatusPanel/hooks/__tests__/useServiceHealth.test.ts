import { act, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, test } from "vitest";

import type { IMockWebSocketConnection } from "../../../../../../test-support/createMockWebSocket";
import { installMockFetch, type IInstalledMockFetch } from "../../../../../../test-support/installMockFetch";
import {
  installMockWebSocket,
  type IInstalledMockWebSocket,
} from "../../../../../../test-support/installMockWebSocket";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../../../../shared/constants";
import type { HealthResponse, IRoutingConfig, IWorktreeRepository, ServiceHealth } from "../../../../shared/types";
import { useServiceHealth } from "../useServiceHealth";

type ServerAction = () => void;

const apiService: ServiceHealth = { managed: true, name: "api", status: true, url: "https://api.shop.localhost" };
const workerService: ServiceHealth = { dirty: true, exitCode: 0, managed: true, name: "worker", status: true };
const repository: IWorktreeRepository = {
  configuredPath: "/projects/shop",
  id: "shop",
  name: "shop",
  runningPath: "/projects/shop",
  selectedPath: "/projects/shop",
  serviceNames: ["api", "worker"],
  switching: false,
  worktrees: [
    { available: true, branch: "main", detached: false, directories: [], head: "abcdef123", path: "/projects/shop" },
  ],
};
const worktreeRequestHeaders: Record<string, string> = { "content-type": "application/json" };

let webSocket: IInstalledMockWebSocket;
let mockFetch: IInstalledMockFetch;

// Lets the socket's queued open or close run, and applies the state updates a server action causes.
async function settle(action?: ServerAction): Promise<void> {
  await act(async (): Promise<void> => {
    action?.();
  });
}

async function connectServiceHealth() {
  const hook = renderHook(() => useServiceHealth());

  await settle();

  const connection: IMockWebSocketConnection | undefined = webSocket.connections.at(0);

  assert(connection !== undefined);

  return { connection, hook };
}

beforeEach(() => {
  webSocket = installMockWebSocket();
  mockFetch = installMockFetch();
});

afterEach(() => {
  webSocket.restore();
  mockFetch.restore();
  Reflect.deleteProperty(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
});

describe("useServiceHealth", () => {
  test("opens one health stream on the current host and starts with nothing to show", async () => {
    const { connection, hook } = await connectServiceHealth();

    expect(connection.url.href).toBe(`ws://${window.location.host}/__devhost__/ws/health`);
    expect(webSocket.connections).toHaveLength(1);
    expect(hook.result.current.services).toEqual([]);
    expect(hook.result.current.repositories).toEqual([]);
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("publishes the services and repositories of each health message", async () => {
    const { connection, hook } = await connectServiceHealth();

    await settle(() => connection.send({ repositories: [repository], services: [apiService, workerService] }));
    expect(hook.result.current.services).toEqual([apiService, workerService]);
    expect(hook.result.current.repositories).toEqual([repository]);

    await settle(() => connection.send({ services: [apiService] }));
    expect(hook.result.current.services).toEqual([apiService]);
    expect(hook.result.current.repositories).toEqual([]);
  });

  test("applies the routing of a health message to the injected configuration", async () => {
    const injectedConfig: Record<string, unknown> = { primaryService: "api", routedServices: [], stackName: "shop" };
    const routing: IRoutingConfig = {
      primaryService: "web",
      routedServices: [{ host: "shop.localhost", path: "/", serviceName: "web" }],
    };

    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, injectedConfig);
    const { connection } = await connectServiceHealth();

    await settle(() => connection.send({ routing, services: [apiService] }));

    const appliedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

    expect(appliedConfig).toEqual({
      primaryService: "web",
      routedServices: [{ host: "shop.localhost", path: "/", serviceName: "web" }],
      stackName: "shop",
    });
    // New routing is published as a new object, so readers can tell a change by identity.
    expect(injectedConfig).toEqual({ primaryService: "api", routedServices: [], stackName: "shop" });

    await settle(() => connection.send({ routing, services: [apiService, workerService] }));
    expect(Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME)).toBe(appliedConfig);
  });

  test("reports frames it cannot read, keeps the last health, and recovers on the next message", async () => {
    const { connection, hook } = await connectServiceHealth();

    await settle(() => connection.send({ services: [apiService] }));

    await settle(() => connection.sendFrame("{"));
    expect(hook.result.current.errorMessage).toBe("devhost status stream sent malformed data.");

    await settle(() => connection.send({ services: [{ name: "api" }] }));
    expect(hook.result.current.errorMessage).toBe("devhost status stream sent malformed data.");

    await settle(() => connection.sendFrame(new ArrayBuffer(1)));
    expect(hook.result.current.errorMessage).toBe("devhost status stream sent a non-text message.");
    expect(hook.result.current.services).toEqual([apiService]);

    await settle(() => connection.send({ services: [apiService, workerService] }));
    expect(hook.result.current.errorMessage).toBeNull();
    expect(hook.result.current.services).toEqual([apiService, workerService]);
  });

  test("clears an error reported before the stream opened", async () => {
    const hook = renderHook(() => useServiceHealth());

    act(() => hook.result.current.setErrorMessage("Restart failed."));
    expect(hook.result.current.errorMessage).toBe("Restart failed.");

    await settle();
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("marks every known service unavailable when the stream drops", async () => {
    const { connection, hook } = await connectServiceHealth();

    await settle(() => connection.send({ repositories: [repository], services: [apiService, workerService] }));
    await settle(() => connection.close(1006));

    expect(hook.result.current.services).toEqual([
      { managed: true, name: "api", status: false, url: "https://api.shop.localhost" },
      { managed: true, name: "worker", status: false },
    ]);
    expect(hook.result.current.repositories).toEqual([]);
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("shows the stack itself as unavailable when the stream drops before any health arrived", async () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, { stackName: "shop" });
    const { connection, hook } = await connectServiceHealth();

    await settle(() => connection.close(1006));

    expect(hook.result.current.services).toEqual([{ managed: false, name: "shop", status: false }]);
  });

  test("keeps the last health when the server closes the stream normally", async () => {
    const { connection, hook } = await connectServiceHealth();

    await settle(() => connection.send({ repositories: [repository], services: [apiService] }));
    await settle(() => connection.close(1000));

    expect(hook.result.current.services).toEqual([apiService]);
    expect(hook.result.current.repositories).toEqual([repository]);
  });

  test("closes the stream when it unmounts", async () => {
    const { connection, hook } = await connectServiceHealth();

    expect(connection.readClientClosure()).toBeNull();

    hook.unmount();
    expect(connection.readClientClosure()).toEqual({ code: 1000, reason: "devtools unmounted" });
  });

  test("refreshWorktrees requests the worktrees and publishes the health it returns", async () => {
    const { hook } = await connectServiceHealth();
    const health: HealthResponse = { repositories: [repository], services: [apiService] };

    mockFetch.fetch.mockResolvedValueOnce(Response.json(health));

    const error: string | null = await act(() => hook.result.current.refreshWorktrees());

    expect(error).toBeNull();
    expect(mockFetch.fetch.mock.calls).toEqual([
      ["/__devhost__/worktrees", { body: undefined, headers: worktreeRequestHeaders, method: "GET" }],
    ]);
    expect(hook.result.current.services).toEqual([apiService]);
    expect(hook.result.current.repositories).toEqual([repository]);
  });

  test("refreshWorktrees returns the server's error and keeps the current health", async () => {
    const { connection, hook } = await connectServiceHealth();

    await settle(() => connection.send({ services: [apiService] }));
    mockFetch.fetch.mockResolvedValueOnce(new Response("git is unavailable\n", { status: 500 }));

    const error: string | null = await act(() => hook.result.current.refreshWorktrees());

    expect(error).toBe("git is unavailable");
    expect(hook.result.current.services).toEqual([apiService]);
  });

  test("switchWorktree posts the selection, then refreshes the health", async () => {
    const { hook } = await connectServiceHealth();
    const health: HealthResponse = { repositories: [repository], services: [workerService] };

    mockFetch.fetch.mockResolvedValueOnce(new Response("")).mockResolvedValueOnce(Response.json(health));

    const error: string | null = await act(() => hook.result.current.switchWorktree("shop", "/worktrees/cart"));

    expect(error).toBeNull();
    expect(mockFetch.fetch.mock.calls).toEqual([
      [
        "/__devhost__/worktrees",
        {
          body: '{"repositoryId":"shop","path":"/worktrees/cart"}',
          headers: worktreeRequestHeaders,
          method: "POST",
        },
      ],
      ["/__devhost__/worktrees", { body: undefined, headers: worktreeRequestHeaders, method: "GET" }],
    ]);
    expect(hook.result.current.services).toEqual([workerService]);
  });

  test("switchWorktree returns the server's refusal and still refreshes the health", async () => {
    const { hook } = await connectServiceHealth();
    const health: HealthResponse = { services: [apiService] };

    mockFetch.fetch
      .mockResolvedValueOnce(new Response("Worktree is busy\n", { status: 409 }))
      .mockResolvedValueOnce(Response.json(health));

    const error: string | null = await act(() => hook.result.current.switchWorktree("shop", "/worktrees/cart"));

    expect(error).toBe("Worktree is busy");
    expect(mockFetch.fetch).toHaveBeenCalledTimes(2);
    expect(hook.result.current.services).toEqual([apiService]);
  });
});
