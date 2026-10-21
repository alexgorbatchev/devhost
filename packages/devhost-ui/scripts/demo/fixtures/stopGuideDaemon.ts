import assert from "node:assert/strict";

export async function stopGuideDaemon(): Promise<void> {
  const response = await fetch(
    `http://${process.env.DEVHOST_BIND_HOST ?? "127.0.0.1"}:${process.env.PORT}/__shutdown`,
    { method: "POST", signal: AbortSignal.timeout(2_000) },
  );
  assert(response.ok, "Daemon stop failed");
  await response.body?.cancel();
  const path = process.env.DEVHOST_DEMO_DAEMON_PID;
  assert(path);
  const pid = Number(await Bun.file(path).text());
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    // An exited daemon its new parent has not reaped yet still answers kill(pid, 0); ps reports it as a zombie.
    const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
      .stdout.toString()
      .trim();
    if (stat === "" || stat.startsWith("Z")) return;
    await Bun.sleep(50);
  }
  throw new Error("Daemon is still running after cooperative shutdown");
}

if (import.meta.main) await stopGuideDaemon();
