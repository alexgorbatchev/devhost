import { join } from "node:path";
import type { IDemoRuntime } from "./types";

export async function restoreDemoPlayground(runtime: IDemoRuntime): Promise<void> {
  const baseline: Record<string, string> = await Bun.file(
    join(runtime.directoryPath, "playground-baseline.json"),
  ).json();
  const changes: Record<string, string> = {};
  for (const [file, original] of Object.entries(baseline)) {
    const path = join(runtime.directoryPath, "playground", file);
    const current = await Bun.file(path).text();
    if (current !== original) {
      changes[file] = current;
      await Bun.write(path, original);
    }
  }
  await Bun.write(join(runtime.directoryPath, "pi-changes.json"), JSON.stringify(changes, null, 2) + "\n");
}
