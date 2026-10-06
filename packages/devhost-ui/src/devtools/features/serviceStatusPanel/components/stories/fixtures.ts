import type { ComponentProps } from "react";

import type { WorktreeRepository } from "../../../../shared/types";
import type { ServiceStatusPanel } from "../ServiceStatusPanel";

export const fixture_healthPollErrorServices: ComponentProps<typeof ServiceStatusPanel> = {
  errorMessage: "Health check failed: devhost control server unreachable (ECONNREFUSED)",
  services: [
    { managed: true, name: "web", status: true },
    { dirty: true, managed: true, name: "api", status: true },
    { managed: true, name: "worker", status: false },
  ],
};

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

export function factory_homeWorktreeRepository(): WorktreeRepository {
  const repository = factory_worktreeRepository();
  return {
    ...repository,
    configuredPath: `/home/alex${repository.configuredPath}`,
    selectedPath: `/home/alex${repository.selectedPath}`,
    runningPath: `/home/alex${repository.runningPath}`,
    worktrees: repository.worktrees.map((entry) => ({
      ...entry,
      path: `/home/alex${entry.path}`,
      directories: entry.directories.map((directory) => ({ ...directory, cwd: `/home/alex${directory.cwd}` })),
    })),
  };
}
