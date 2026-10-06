import { describe, expect, test } from "bun:test";

import { parseHealthResponse } from "../parseHealthResponse";

describe("parseHealthResponse", () => {
  test("retains effective source roots and repository state from the supervisor", () => {
    const payload = {
      services: [{ name: "web", managed: true, status: false, projectRootPath: "/feature" }],
      repositories: [
        {
          id: "shop",
          name: "shop",
          configuredPath: "/main",
          selectedPath: "/feature",
          runningPath: "",
          serviceNames: ["web"],
          switching: false,
          error: "Startup failed",
          worktrees: [
            {
              path: "/feature",
              branch: "feature/cart",
              head: "abc",
              detached: false,
              available: true,
              directories: [{ name: "web", cwd: "/feature/web" }],
            },
          ],
        },
      ],
    };
    expect(parseHealthResponse(JSON.stringify(payload))).toEqual(payload);
  });

  test.each([
    "not json",
    JSON.stringify({ services: [{ name: "web", managed: true, status: "up" }] }),
    JSON.stringify({ services: [], repositories: [{ id: "shop" }] }),
    JSON.stringify({ services: [], repositories: "shop" }),
  ])("rejects malformed health data: %s", (message) => {
    expect(parseHealthResponse(message)).toBeNull();
  });
});
