import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { INativeReactAutomation } from "./types";

export function createNativeReactAutomation(
  endpoint: string,
  outputPath: string,
  repositoryRoot: string,
): INativeReactAutomation {
  const namespace: string = "n";
  const socketDirectoryPath = resolve(repositoryRoot, ".tmp", `nr-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(socketDirectoryPath, { mode: 0o700 });
  const sessions = new Map<string, string>();
  let sequence: number = 0;
  const run = async (targetId: string, label: string, argumentsList: string[]): Promise<string> => {
    const existingIndex = Array.from(sessions.keys()).indexOf(targetId);
    const session: string = `t${existingIndex === -1 ? sessions.size : existingIndex}`;
    let configurationPath = sessions.get(targetId);
    if (configurationPath === undefined) {
      const providerPath = resolve(outputPath, `${session}-provider.ts`);
      configurationPath = resolve(outputPath, `${session}-agent.json`);
      await Bun.write(
        providerPath,
        `Bun.env.DEVHOST_NATIVE_REACT_TARGET = ${JSON.stringify(JSON.stringify({ endpoint, targetId }))};\nawait import(${JSON.stringify(resolve(import.meta.dir, "provideNativeReactTargetMain.ts"))});\n`,
      );
      await Bun.write(
        configurationPath,
        JSON.stringify({
          plugins: [
            { name: "native-react-owned", command: "bun", args: [providerPath], capabilities: ["browser.provider"] },
          ],
        }),
      );
      sessions.set(targetId, configurationPath);
    }
    const command = [
      "agent-browser",
      "--namespace",
      namespace,
      "--session",
      session,
      "--config",
      configurationPath,
      "-p",
      "native-react-owned",
      ...argumentsList,
    ];
    const prefix = resolve(outputPath, `${String(++sequence).padStart(3, "0")}-${label}`);
    await Bun.write(`${prefix}.command.json`, JSON.stringify({ command, cwd: repositoryRoot }, null, 2));
    const child = Bun.spawn(command, {
      cwd: repositoryRoot,
      env: { ...process.env, TMPDIR: resolve(repositoryRoot, ".tmp"), AGENT_BROWSER_SOCKET_DIR: socketDirectoryPath },
      timeout: 40_000,
      stdout: Bun.file(`${prefix}.stdout.log`),
      stderr: Bun.file(`${prefix}.stderr.log`),
    });
    const exit = await child.exited;
    await Bun.write(`${prefix}.exit`, `${exit}\n`);
    assert.equal(exit, 0, await Bun.file(`${prefix}.stderr.log`).text());
    return Bun.file(`${prefix}.stdout.log`).text();
  };
  return {
    run,
    stop: async (): Promise<void> => {
      const outcomes = await Promise.allSettled(
        Array.from(sessions.keys(), (id) => run(id, "detach-automation", ["close"])),
      );
      await Bun.write(
        resolve(outputPath, "automation-cleanup.json"),
        JSON.stringify({ namespace, socketDirectoryPath, outcomes }, null, 2),
      );
      for (const result of outcomes) assert.equal(result.status, "fulfilled", JSON.stringify(result));
    },
  };
}
