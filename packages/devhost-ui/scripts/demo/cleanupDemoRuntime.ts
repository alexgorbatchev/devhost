import { join } from "node:path";
import { runCommand } from "./runCommand";
import type { IDemoRuntime } from "./types";
import { restoreDemoPlayground } from "./restoreDemoPlayground";

export async function cleanupDemoRuntime(runtime: IDemoRuntime): Promise<void> {
  await runCommand(
    [join(runtime.repositoryPath, "apps/devhost/dist/devhost"), "stop", "--manifest", runtime.manifestPath],
    {
      env: runtime.env,
      timeoutMs: 30_000,
      logPath: join(runtime.directoryPath, "cleanup.log"),
    },
  );
  await restoreDemoPlayground(runtime);
}
