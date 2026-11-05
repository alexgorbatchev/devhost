import type { TestProcessSignal } from "./types";

/** Stops a fixture spawned with `detached: true`, including children that share its process group. */
export async function stopTestProcessGroup(child: Bun.Subprocess): Promise<void> {
  if (signalGroup(child.pid, "SIGTERM")) {
    const deadline = Date.now() + 5000;
    while (signalGroup(child.pid, 0) && Date.now() < deadline) await Bun.sleep(25);
    signalGroup(child.pid, "SIGKILL");
  }
  await child.exited;
  const deadline = Date.now() + 5000;
  while (signalGroup(child.pid, 0)) {
    if (Date.now() >= deadline) throw new Error(`Test process group ${child.pid} survived shutdown`);
    await Bun.sleep(25);
  }
}

function signalGroup(pid: number, signal: TestProcessSignal): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}
