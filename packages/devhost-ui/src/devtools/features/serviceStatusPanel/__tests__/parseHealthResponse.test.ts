import { describe, expect, test } from "bun:test";

import type { HealthResponse } from "../../../shared/types";
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
          defaultBranch: "trunk",
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

  test("retains the services a run left stopped", () => {
    const payload = {
      services: [{ name: "web", managed: true, status: true }],
      stoppedServices: [{ name: "docs" }, { name: "db" }],
    };
    expect(parseHealthResponse(JSON.stringify(payload))).toEqual(payload);
  });

  test("retains the page configuration devhost sends with the health", () => {
    const payload = {
      services: [{ name: "web", managed: true, status: true }],
      config: { stackName: "shop", minimapEnabled: false },
    };
    expect(parseHealthResponse(JSON.stringify(payload))).toEqual(payload);
  });

  test("retains the reloads of each configuration source and the last rejection", () => {
    const payload: HealthResponse = {
      services: [{ name: "web", managed: true, status: true }],
      configuration: [
        { source: "config", reloads: 1 },
        { source: "manifest", reloads: 3, error: "Failed to parse devhost.toml" },
      ],
    };
    expect(parseHealthResponse(JSON.stringify(payload))).toEqual(payload);
  });

  test.each([
    "not json",
    JSON.stringify({ services: [], configuration: "manifest" }),
    JSON.stringify({ services: [], configuration: [{ source: "caddy", reloads: 1 }] }),
    JSON.stringify({ services: [], configuration: [{ source: "manifest", reloads: "1" }] }),
    JSON.stringify({ services: [], configuration: [{ source: "manifest", reloads: 1, error: 42 }] }),
    JSON.stringify({ services: [], stoppedServices: "docs" }),
    JSON.stringify({ services: [], stoppedServices: ["docs"] }),
    JSON.stringify({ services: [], stoppedServices: [{ name: 42 }] }),
    JSON.stringify({ services: [{ name: "web", managed: true, status: "up" }] }),
    JSON.stringify({ services: [], repositories: [{ id: "shop" }] }),
    JSON.stringify({ services: [], repositories: "shop" }),
    JSON.stringify({ services: [], config: "invalid" }),
    JSON.stringify({ services: [], config: null }),
    JSON.stringify({ services: [], config: [] }),
  ])("rejects malformed health data: %s", (message) => {
    expect(parseHealthResponse(message)).toBeNull();
  });
});
