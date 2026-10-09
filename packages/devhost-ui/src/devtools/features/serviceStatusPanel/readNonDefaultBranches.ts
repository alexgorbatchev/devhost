import type { IWorktreeRepository } from "../../shared/types";

export function readNonDefaultBranches(repositories: IWorktreeRepository[]): string[] {
  return repositories.flatMap((repository) => {
    const selected = repository.worktrees.find((entry) => entry.path === repository.selectedPath);
    if (
      repository.defaultBranch === "" ||
      selected === undefined ||
      selected.detached ||
      selected.branch === "" ||
      selected.branch === repository.defaultBranch
    ) {
      return [];
    }
    return [`${repository.name}: ${selected.branch}`];
  });
}
