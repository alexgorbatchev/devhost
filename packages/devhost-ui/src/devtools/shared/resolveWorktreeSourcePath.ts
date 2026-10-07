import { cleanSourcePath } from "./sourceLocation";
import type { IWorktreeRepository } from "./types";

export function resolveWorktreeSourcePath(rawFileName: string, repository: IWorktreeRepository | undefined): string {
  const path = cleanSourcePath(rawFileName).replace(/\\/g, "/");
  if (repository === undefined) return path;
  const selected = repository.selectedPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (path === selected || path.startsWith(selected + "/")) return path;
  const roots = [repository.configuredPath, ...repository.worktrees.map((entry) => entry.path)]
    .map((root) => root.replace(/\\/g, "/").replace(/\/+$/, ""))
    .sort((left, right) => right.length - left.length);
  for (const root of roots) {
    if (path === root || path.startsWith(root + "/")) return selected + path.slice(root.length);
  }
  return path;
}
