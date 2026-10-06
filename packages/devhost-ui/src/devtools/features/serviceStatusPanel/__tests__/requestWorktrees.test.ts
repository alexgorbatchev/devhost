import { describe, expect, test } from "bun:test";

import { requestWorktrees } from "../requestWorktrees";

function createFetch(
  handler: (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: (): void => {} });
}

describe("requestWorktrees", () => {
  test("authenticates discovery and parses the supervisor health response", async () => {
    const result = await requestWorktrees(
      "token",
      createFetch(async (input, init) => {
        expect(input).toBe("/__devhost__/worktrees");
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).get("x-devhost-control-token")).toBe("token");
        expect(init?.body).toBeUndefined();
        return Response.json({ services: [{ name: "web", status: true, managed: true }] });
      }),
    );
    expect(result).toEqual({ health: { services: [{ name: "web", status: true, managed: true }] }, error: null });
  });

  test("posts the repository and exact checkout path without changing the manifest", async () => {
    const result = await requestWorktrees(
      "token",
      createFetch(async (input, init) => {
        expect(input).toBe("/__devhost__/worktrees");
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("x-devhost-control-token")).toBe("token");
        expect(JSON.parse(String(init?.body))).toEqual({ repositoryId: "shop", path: "/feature checkout" });
        return new Response(null, { status: 204 });
      }),
      { repositoryId: "shop", path: "/feature checkout" },
    );
    expect(result).toEqual({ health: null, error: null });
  });

  test("reports discovery and launch failures", async () => {
    expect(
      await requestWorktrees(
        "token",
        createFetch(async () => new Response("Git failed\n", { status: 500 })),
      ),
    ).toEqual({ health: null, error: "Git failed" });
    expect(
      await requestWorktrees(
        "token",
        createFetch(async () => {
          throw new Error("Network unavailable");
        }),
      ),
    ).toEqual({ health: null, error: "Network unavailable" });
    expect(
      await requestWorktrees(
        "token",
        createFetch(async () => Response.json({ services: "invalid" })),
      ),
    ).toEqual({ health: null, error: "devhost returned malformed worktree data." });
  });
});
