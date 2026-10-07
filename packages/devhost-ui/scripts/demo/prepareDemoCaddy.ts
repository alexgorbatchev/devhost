import { join } from "node:path";
import { runCommand } from "./runCommand";
import type { IDemoRuntime } from "./types";

export async function prepareDemoCaddy(runtime: IDemoRuntime, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(`http://${runtime.adminAddress}/config/`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
    });
    if (!response.ok) throw new Error(`Caddy admin returned HTTP ${response.status}`);
    await response.body?.cancel();
    const certificate = await runCommand(
      [join(runtime.repositoryPath, "apps/devhost/dist/devhost"), "caddy", "print-root-cert"],
      { env: runtime.env, signal },
    );
    await Bun.write(runtime.certificatePath, certificate);
    const site = await fetch(runtime.url, {
      tls: { ca: certificate },
      signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
    });
    await site.body?.cancel();
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(
      `Recording requires managed Caddy at ${runtime.url}, with its admin endpoint at ${runtime.adminAddress}. Run 'devhost caddy start' before recording.`,
      { cause: error },
    );
  }
}
