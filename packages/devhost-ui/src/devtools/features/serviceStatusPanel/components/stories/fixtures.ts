import type { ComponentProps } from "react";

import type { IStoppedService, IWorktreeRepository } from "../../../../shared/types";
import type { ServiceStatusPanel } from "../ServiceStatusPanel";

export const fixture_healthPollErrorServices: ComponentProps<typeof ServiceStatusPanel> = {
  errorMessage: "Health check failed: devhost control server unreachable (ECONNREFUSED)",
  services: [
    { managed: true, name: "web", status: true },
    { dirty: true, managed: true, name: "api", status: true },
    { managed: true, name: "worker", status: false },
  ],
};

export const fixture_stoppedServices: IStoppedService[] = [{ name: "docs" }, { name: "admin" }, { name: "mail" }];

export function factory_worktreeRepository(
  serviceNames: string[] = ["api", "web"],
  defaultBranch: string = "main",
): IWorktreeRepository {
  return {
    id: "shop",
    name: "shop",
    defaultBranch,
    configuredPath: "/projects/shop",
    selectedPath: "/projects/shop",
    runningPath: "/projects/shop",
    switching: false,
    serviceNames,
    worktrees: [
      {
        path: "/projects/shop",
        branch: defaultBranch || "main",
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

export function factory_homeWorktreeRepository(): IWorktreeRepository {
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

export function factory_occupiedWorktreeRepository(urls: string[] = ["https://cart.localhost/"]): IWorktreeRepository {
  const repository = factory_worktreeRepository();
  return {
    ...repository,
    worktrees: repository.worktrees.map((entry) =>
      entry.path === "/worktrees/cart"
        ? {
            ...entry,
            available: false,
            reason: "In use by another stack. Open it to view, or stop it before switching.",
            owners: [
              {
                id: "owner-instance",
                name: "cart-storybook",
                pid: 1234,
                manifestPath: "/worktrees/cart/devhost.toml",
                urls,
              },
            ],
          }
        : entry,
    ),
  };
}

export function factory_longPathWorktreeRepository(): IWorktreeRepository {
  const repository = factory_worktreeRepository();
  const path = `/development/projects/${"long parent directory/".repeat(8)}.workspaces/worktree-stack-switch`;
  return {
    ...repository,
    configuredPath: path,
    selectedPath: path,
    runningPath: path,
    worktrees: [{ ...repository.worktrees[0]!, path }],
  };
}
