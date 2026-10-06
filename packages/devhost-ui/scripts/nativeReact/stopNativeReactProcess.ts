import type { Subprocess } from "bun";

export async function stopNativeReactProcess(child: Subprocess): Promise<number> {
  if (child.exitCode === null) child.kill("SIGTERM");
  const termination = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 10_000);
  try {
    return await child.exited;
  } finally {
    clearTimeout(termination);
  }
}
