import { join } from "node:path";
import type { Subprocess } from "bun";
import { isDemoStackReady } from "./isDemoStackReady";
import type { IDemoRuntime } from "./types";
import { stopProcess } from "./stopProcess";

export async function startDemoStack(runtime: IDemoRuntime, signal: AbortSignal): Promise<Subprocess> {
  const certificate = await Bun.file(runtime.certificatePath).text();
  const subprocess = Bun.spawn([join(runtime.repositoryPath, "apps/devhost/bin/devhost"), "start"], {
    cwd: runtime.directoryPath,
    env: runtime.env,
    stdin: "ignore",
    stdout: Bun.file(join(runtime.directoryPath, "stack.stdout.log")),
    stderr: Bun.file(join(runtime.directoryPath, "stack.stderr.log")),
  });
  try {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      signal.throwIfAborted();
      if (subprocess.exitCode !== null) {
        throw new Error(`Demo stack exited (${subprocess.exitCode}). Inspect stack.stdout.log and stack.stderr.log`);
      }
      try {
        if (await isDemoStackReady(runtime.url, signal, certificate)) return subprocess;
      } catch {
        signal.throwIfAborted();
      }
      await Bun.sleep(100);
    }
    throw new Error("Demo stack did not become healthy within its startup deadline");
  } catch (error) {
    await stopProcess(subprocess);
    throw error;
  }
}
