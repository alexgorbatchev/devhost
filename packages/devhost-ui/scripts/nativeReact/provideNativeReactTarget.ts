import assert from "node:assert/strict";
import { z } from "zod";
import { readNativeReactTargets } from "./readNativeReactTargets";

export async function provideNativeReactTarget(endpoint: string, targetId: string): Promise<void> {
  const input: unknown = JSON.parse(await Bun.stdin.text());
  z.object({ type: z.literal("browser.launch") }).parse(input);
  const targets = await readNativeReactTargets(endpoint);
  const target = targets.find((candidate) => candidate.id === targetId);
  assert(target?.webSocketDebuggerUrl, "Explicit owned native target is gone.");
  console.log(
    JSON.stringify({
      protocol: "agent-browser.plugin.v1",
      success: true,
      browser: {
        cdpUrl: target.webSocketDebuggerUrl,
        directPage: true,
        metadata: { url: target.url, ownership: "Fresh fixture-owned browser, connection-only automation" },
      },
    }),
  );
}
