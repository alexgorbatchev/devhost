import type { Subprocess } from "bun";

export async function stopProcess(subprocess: Subprocess, gracePeriodMs = 10_000): Promise<void> {
  if (subprocess.exitCode !== null) return;
  subprocess.kill("SIGTERM");
  const timeout = setTimeout(() => subprocess.kill("SIGKILL"), gracePeriodMs);
  try {
    await subprocess.exited;
  } finally {
    clearTimeout(timeout);
  }
}
