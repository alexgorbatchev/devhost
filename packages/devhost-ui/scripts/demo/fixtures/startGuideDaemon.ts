import assert from "node:assert/strict";

export async function startGuideDaemon(): Promise<void> {
  const subprocess = Bun.spawn(["setsid", "--fork", "bun", "serveGuideService.ts"], {
    stdin: "ignore",
    stdout: Bun.file("daemon.log"),
    stderr: Bun.file("daemon.stderr.log"),
  });
  assert.equal(await subprocess.exited, 0, "Daemon launch failed");
}

if (import.meta.main) await startGuideDaemon();
