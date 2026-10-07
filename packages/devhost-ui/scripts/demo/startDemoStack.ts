import { join } from "node:path";
import type { Subprocess } from "bun";
import type { DemoRuntime } from "./types";
import { stopProcess } from "./stopProcess";

export async function startDemoStack(runtime: DemoRuntime, signal: AbortSignal): Promise<Subprocess> {
  const certificate = await Bun.file(runtime.certificatePath).text();
  const subprocess = Bun.spawn([join(runtime.repositoryPath, "apps/devhost/dist/devhost"), "start"], {
    cwd: runtime.directoryPath,
    env: runtime.env,
    stdin: "ignore",
    stdout: Bun.file(join(runtime.directoryPath, "stack.stdout.log")),
    stderr: Bun.file(join(runtime.directoryPath, "stack.stderr.log")),
  });
  const probe = new URL("/api/hello", runtime.url);
  try {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      signal.throwIfAborted();
      if (subprocess.exitCode !== null) {
        throw new Error(`Demo stack exited (${subprocess.exitCode}). Inspect stack.stdout.log and stack.stderr.log`);
      }
      try {
        const response = await fetch(probe, {
          tls: { ca: certificate },
          signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
        });
        if (response.ok) {
          await response.body?.cancel();
          const frontend = await fetch(new URL("/", probe), {
            tls: { ca: certificate },
            signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
          });
          const isFrontendReady = frontend.ok;
          await frontend.body?.cancel();
          if (isFrontendReady) return subprocess;
        }
        await response.body?.cancel();
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
