import { mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IDemoRuntime } from "./types";

export async function createDemoPlayground(runtime: IDemoRuntime): Promise<void> {
  const baseline: Record<string, string> = {};
  for (const app of ["frontend", "backend"]) {
    const sourcePath = join(runtime.repositoryPath, "packages/playground", app);
    for (const pattern of ["src/**/*", "package.json"]) {
      for await (const file of new Bun.Glob(pattern).scan({ cwd: sourcePath, onlyFiles: true })) {
        const key = `${app}/${file}`;
        const targetPath = join(runtime.directoryPath, "playground", key);
        baseline[key] = await Bun.file(join(sourcePath, file)).text();
        await mkdir(dirname(targetPath), { recursive: true });
        await Bun.write(targetPath, baseline[key]);
      }
    }
  }
  await symlink(
    join(runtime.repositoryPath, "packages/playground/frontend/node_modules"),
    join(runtime.directoryPath, "playground/frontend/node_modules"),
    "dir",
  );
  await Bun.write(join(runtime.directoryPath, "playground-baseline.json"), JSON.stringify(baseline));
}
