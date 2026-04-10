import { describe, expect, test } from "bun:test";

import type { IResolvedDevhostService } from "../../types/stackTypes";
import { readLoopbackBindHostAmbiguityWarning } from "../readLoopbackBindHostAmbiguityWarning";

describe("readLoopbackBindHostAmbiguityWarning", () => {
  test("returns a recommendation when localhost matches the opposite loopback listener", async () => {
    const warning = await readLoopbackBindHostAmbiguityWarning({
      fetchImpl: createFetchStub({
        "http://localhost:5173/": { location: null, status: 200 },
        "http://127.0.0.1:5173/": { location: "/api", status: 302 },
        "http://[::1]:5173/": { location: null, status: 200 },
      }),
      service: createRoutedService(),
    });

    expect(warning).toContain("services.toolbar-test.port = 5173 is ambiguous");
    expect(warning).toContain('Consider setting services.toolbar-test.bindHost = "::1".');
  });

  test("returns null when localhost and the routed upstream behave the same", async () => {
    const warning = await readLoopbackBindHostAmbiguityWarning({
      fetchImpl: createFetchStub({
        "http://localhost:5173/": { location: null, status: 200 },
        "http://127.0.0.1:5173/": { location: null, status: 200 },
        "http://[::1]:5173/": { location: null, status: 200 },
      }),
      service: createRoutedService(),
    });

    expect(warning).toBeNull();
  });

  test("returns null for unrouted services", async () => {
    const warning = await readLoopbackBindHostAmbiguityWarning({
      fetchImpl: createFetchStub({}),
      service: {
        ...createRoutedService(),
        host: null,
      },
    });

    expect(warning).toBeNull();
  });
});

function createFetchStub(responsesByUrl: Record<string, { location: string | null; status: number }>): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const response = responsesByUrl[url];

    if (response === undefined) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    const headers = new Headers();

    if (response.location !== null) {
      headers.set("location", response.location);
    }

    return new Response(null, {
      headers,
      status: response.status,
    });
  }) as typeof fetch;
}

function createRoutedService(): IResolvedDevhostService {
  return {
    bindHost: "127.0.0.1",
    command: ["bun", "dev"],
    cwd: "/tmp/project",
    dependsOn: [],
    env: {},
    health: {
      host: "127.0.0.1",
      interval: 200,
      kind: "tcp",
      port: 5173,
      retries: 0,
      timeout: 30_000,
    },
    host: "test.localhost",
    name: "toolbar-test",
    path: "/",
    port: 5173,
    portSource: "fixed",
  };
}
