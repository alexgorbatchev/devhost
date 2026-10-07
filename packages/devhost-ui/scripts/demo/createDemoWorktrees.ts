import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "./runCommand";
import type { IDemoRuntime } from "./types";

export async function createDemoWorktrees(runtime: IDemoRuntime): Promise<void> {
  const cwd = join(runtime.directoryPath, "playground");
  const env: NodeJS.ProcessEnv = { ...runtime.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const baseline: Record<string, string> = await Bun.file(
    join(runtime.directoryPath, "playground-baseline.json"),
  ).json();
  await runCommand(["git", "init", "--quiet", "--initial-branch=main"], { cwd, env });
  await runCommand(["git", "config", "user.name", "Devhost Demo"], { cwd, env });
  await runCommand(["git", "config", "user.email", "demo@localhost"], { cwd, env });
  await Bun.write(join(cwd, ".gitignore"), "node_modules\n.workspaces/\n");
  await runCommand(["git", "add", "--", ".gitignore", ...Object.keys(baseline)], { cwd, env });
  await runCommand(["git", "commit", "--quiet", "-m", "Initialize recording playground"], { cwd, env });
  const alternatePath = join(cwd, ".workspaces/ui-polish");
  await runCommand(["git", "worktree", "add", "--quiet", "-b", "ui-polish", alternatePath, "main"], { cwd, env });
  await symlink(
    join(runtime.repositoryPath, "packages/playground/frontend/node_modules"),
    join(alternatePath, "frontend/node_modules"),
    "dir",
  );
}
