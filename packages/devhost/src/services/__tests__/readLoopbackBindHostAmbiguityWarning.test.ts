import assert from "node:assert/strict";

import { describe, expect, test } from "bun:test";

import type { IResolvedDevhostService } from "../../types/stackTypes";
import { readLoopbackBindHostAmbiguityWarning } from "../readLoopbackBindHostAmbiguityWarning";

interface IFetchStubResponse {
  location: string | null;
  status: number;
}

type HeaderEntry = [string, string];
type FetchInput = RequestInfo | URL;

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

function createFetchStub(responsesByUrl: Record<string, IFetchStubResponse>): typeof fetch {
  return (async (input: FetchInput): Promise<Response> => {
    const url = String(input);
    const response = responsesByUrl[url];

    assert(response !== undefined, `Unexpected URL: ${url}`);

    const headerEntries: HeaderEntry[] = [response.location]
      .filter((location): location is string => location !== null)
      .map((location) => ["location", location]);
    const headers = new Headers(headerEntries);

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
