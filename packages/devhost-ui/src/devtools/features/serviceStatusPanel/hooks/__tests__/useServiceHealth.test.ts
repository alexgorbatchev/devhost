import { act, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, test, vi } from "vitest";

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
  vi.useRealTimers();
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
    expect(hook.result.current.stoppedServices).toEqual([]);
    expect(hook.result.current.errorMessage).toBeNull();
  });

  test("publishes the stopped services of each health message and forgets them when the stream drops", async () => {
    const { connection, hook } = await connectServiceHealth();

    await settle(() =>
      connection.send({ services: [apiService], stoppedServices: [{ name: "docs" }, { name: "db" }] }),
    );
    expect(hook.result.current.stoppedServices).toEqual([{ name: "docs" }, { name: "db" }]);

    await settle(() => connection.send({ services: [apiService], stoppedServices: [{ name: "db" }] }));
    expect(hook.result.current.stoppedServices).toEqual([{ name: "db" }]);

    await settle(() => connection.send({ services: [apiService] }));
    expect(hook.result.current.stoppedServices).toEqual([]);

    await settle(() => connection.send({ services: [apiService], stoppedServices: [{ name: "db" }] }));
    await settle(() => connection.close(1006));
    expect(hook.result.current.stoppedServices).toEqual([]);
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

  test("asks devhost to start stopped services and reports why it could not", async () => {
    const { hook } = await connectServiceHealth();

    mockFetch.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await hook.result.current.startStoppedServices(["docs", "admin"])).toBeNull();
    expect(mockFetch.fetch.mock.calls).toEqual([
      [
        "/__devhost__/start-service",
        { body: JSON.stringify({ serviceNames: ["docs", "admin"] }), headers: worktreeRequestHeaders, method: "POST" },
      ],
    ]);

    mockFetch.fetch.mockResolvedValueOnce(new Response("service docs is already started\n", { status: 500 }));
    expect(await hook.result.current.startStoppedServices(["docs"])).toBe(
      "Failed to start docs: service docs is already started",
    );
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

  test("reopens the stream a second after it drops and shows the health the server sends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { connection, hook } = await connectServiceHealth();

    await settle(() => connection.send({ services: [apiService] }));
    await settle(() => connection.close(1006));
    expect(hook.result.current.services).toEqual([
      { managed: true, name: "api", status: false, url: "https://api.shop.localhost" },
    ]);

    await settle(() => vi.advanceTimersByTime(999));
    expect(webSocket.attemptCount).toBe(1);

    await settle(() => vi.advanceTimersByTime(1));
    expect(webSocket.attemptCount).toBe(2);

    const reopened: IMockWebSocketConnection | undefined = webSocket.connections.at(1);

    assert(reopened !== undefined);
    expect(reopened.url.href).toBe(connection.url.href);

    await settle(() => reopened.send({ services: [apiService] }));
    expect(hook.result.current.services).toEqual([apiService]);
  });

  test("waits twice as long after each failed attempt, up to ten seconds, and starts over once connected", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { connection } = await connectServiceHealth();
    const attemptCounts: number[] = [];

    webSocket.isRefusingConnections = true;
    await settle(() => connection.close(1006));

    // One attempt is due after each of these waits: 1s, 2s, 4s, 8s, then 10s each time.
    for (const delay of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000]) {
      await settle(() => vi.advanceTimersByTime(delay - 1));
      attemptCounts.push(webSocket.attemptCount);
      await settle(() => vi.advanceTimersByTime(1));
      attemptCounts.push(webSocket.attemptCount);
    }
    expect(attemptCounts).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7]);

    webSocket.isRefusingConnections = false;
    await settle(() => vi.advanceTimersByTime(10_000));
    expect(webSocket.connections).toHaveLength(2);

    const reopened: IMockWebSocketConnection | undefined = webSocket.connections.at(1);

    assert(reopened !== undefined);
    await settle(() => reopened.close(1006));
    await settle(() => vi.advanceTimersByTime(1_000));
    expect(webSocket.connections).toHaveLength(3);
  });

  test("does not reopen a stream the server closed normally", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { connection } = await connectServiceHealth();

    await settle(() => connection.close(1000));
    await settle(() => vi.advanceTimersByTime(60_000));

    expect(webSocket.attemptCount).toBe(1);
  });

  test("stops reconnecting when it unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { connection, hook } = await connectServiceHealth();

    await settle(() => connection.close(1006));
    hook.unmount();
    await settle(() => vi.advanceTimersByTime(60_000));

    expect(webSocket.attemptCount).toBe(1);
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
