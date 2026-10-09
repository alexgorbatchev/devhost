import type { IWorktreeRepository } from "../types";

/** A repository configured at `/projects/shop` with two more checkouts under `/worktrees`. */
export function factory_worktreeRepository(): IWorktreeRepository {
  return {
    id: "shop",
    name: "shop",
    configuredPath: "/projects/shop",
    defaultBranch: "main",
    selectedPath: "/projects/shop",
    runningPath: "/projects/shop",
    switching: false,
    serviceNames: ["api", "web"],
    worktrees: [
      { path: "/projects/shop", branch: "main", head: "abcdef123", detached: false, available: true, directories: [] },
      {
        path: "/worktrees/cart",
        branch: "feature/cart",
        head: "123456789",
        detached: false,
        available: true,
        directories: [],
      },
      {
        path: "/worktrees/experiment",
        branch: "",
        head: "deadbeef12",
        detached: true,
        available: true,
        directories: [],
      },
    ],
  };
}
