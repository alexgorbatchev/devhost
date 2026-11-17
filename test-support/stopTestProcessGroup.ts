import type { TestProcessSignal } from "./types";

/** Stops a fixture spawned with `detached: true`, including children that share its process group. */
export async function stopTestProcessGroup(child: Bun.Subprocess): Promise<void> {
  if (signalTestProcessGroup(child.pid, "SIGTERM")) {
    const deadline = Date.now() + 5000;
    while (signalTestProcessGroup(child.pid, 0) && Date.now() < deadline) await Bun.sleep(25);
    signalTestProcessGroup(child.pid, "SIGKILL");
  }
  await child.exited;
  const deadline = Date.now() + 5000;
  while (signalTestProcessGroup(child.pid, 0)) {
    if (Date.now() >= deadline) throw new Error(`Test process group ${child.pid} survived shutdown`);
    await Bun.sleep(25);
  }
}

/**
 * Sends `signal` to a process group and reports whether a member of it is still running. A member that is exiting,
 * or exited but is not reaped yet (a zombie), stays in its group: Linux accepts signals for a zombie, and macOS
 * answers EPERM for a group that holds nothing else. The process table settles both, so only a running member keeps
 * the group live, and EPERM while a member runs is a real permission error.
 */
export function signalTestProcessGroup(groupId: number, signal: TestProcessSignal): boolean {
  try {
    process.kill(-groupId, signal);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ESRCH") return false;
    if (code !== "EPERM" || hasRunningMember(groupId)) throw error;
    return false;
  }
  return hasRunningMember(groupId);
}

function hasRunningMember(groupId: number): boolean {
  const table = Bun.spawnSync(["ps", "-A", "-o", "pgid=", "-o", "stat="], { stdout: "pipe", stderr: "pipe" });
  if (!table.success) throw new Error(`Could not read the process table: ${table.stderr.toString().trim()}`);
  return table.stdout
    .toString()
    .split("\n")
    .some((row) => {
      const [pgid, state] = row.trim().split(/\s+/);
      return Number(pgid) === groupId && state !== undefined && isRunningProcessState(state);
    });
}

/**
 * Reads a `ps` STAT value. Its first letter is the state, Z for a zombie and X for a dead process (Linux); macOS
 * adds the E flag to a process that is exiting, whose state can read `?` until it becomes a zombie.
 */
export function isRunningProcessState(state: string): boolean {
  return !/^[ZX]/.test(state) && !state.includes("E");
}
