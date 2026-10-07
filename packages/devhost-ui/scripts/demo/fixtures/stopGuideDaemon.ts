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
    const stat = await Bun.file(`/proc/${pid}/stat`)
      .text()
      .catch(() => "");
    if (stat.split(") ")[1]?.startsWith("Z ")) return;
    await Bun.sleep(50);
  }
  throw new Error("Daemon is still running after cooperative shutdown");
}

if (import.meta.main) await stopGuideDaemon();
