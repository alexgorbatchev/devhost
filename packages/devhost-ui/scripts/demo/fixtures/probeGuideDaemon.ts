export async function probeGuideDaemon(): Promise<boolean> {
  const response = await fetch(`http://${process.env.DEVHOST_BIND_HOST ?? "127.0.0.1"}:${process.env.PORT}/`, {
    signal: AbortSignal.timeout(1_000),
  }).catch(() => null);
  const isHealthy = response?.ok === true;
  await response?.body?.cancel();
  return isHealthy;
}

if (import.meta.main) process.exit((await probeGuideDaemon()) ? 0 : 1);
