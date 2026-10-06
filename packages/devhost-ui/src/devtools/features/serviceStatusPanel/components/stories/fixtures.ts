import type { WorktreeRepository } from "../../../../shared/types";

export function factory_worktreeRepository(serviceNames: string[] = ["api", "web"]): WorktreeRepository {
  return {
    id: "shop",
    name: "shop",
    configuredPath: "/projects/shop",
    selectedPath: "/projects/shop",
    runningPath: "/projects/shop",
    switching: false,
    serviceNames,
    worktrees: [
      {
        path: "/projects/shop",
        branch: "main",
        head: "abcdef123",
        detached: false,
        available: true,
        directories: serviceNames.map((name) => ({ name, cwd: `/projects/shop/${name}` })),
      },
      {
        path: "/worktrees/cart",
        branch: "feature/cart",
        head: "123456789",
        detached: false,
        available: true,
        directories: serviceNames.map((name) => ({ name, cwd: `/worktrees/cart/${name}` })),
      },
      {
        path: "/worktrees/experiment",
        branch: "",
        head: "deadbeef12",
        detached: true,
        available: true,
        directories: serviceNames.map((name) => ({ name, cwd: `/worktrees/experiment/${name}` })),
      },
      {
        path: "/worktrees/missing",
        branch: "feature/missing",
        head: "fedcba123",
        detached: false,
        available: false,
        reason: "Checkout directory is missing.",
        directories: [],
      },
    ],
  };
}
