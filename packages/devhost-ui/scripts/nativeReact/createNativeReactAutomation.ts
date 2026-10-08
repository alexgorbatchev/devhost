import { E2E_TEMPORARY_PATH } from "../../../../test-support/constants";
import { mkdirSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { relative, resolve } from "node:path";
import type { INativeReactAutomation } from "./types";
import { isNativeReactOwnedProcessAlive, readNativeReactOwnedProcesses } from "./readNativeReactOwnedProcesses";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";
import { readNativeReactTargets } from "./readNativeReactTargets";

interface INativeReactDaemonRecord {
  pid: number;
  targetId: string;
  session: string;
  configurationPath: string;
  pidPath: string;
  socketDirectoryPath: string;
  namespace: string;
}

export function createNativeReactAutomation(
  endpoint: string,
  outputPath: string,
  repositoryRoot: string,
): INativeReactAutomation {
  const namespace: string = "n";
  const socketDirectoryPath = resolve(E2E_TEMPORARY_PATH, `nr-${crypto.randomUUID().slice(0, 8)}`);
  // The pinned CLI retains relative socket paths and its daemon inherits cwd.
  // Keep the Unix pathname short and outside the checkout.
  const socketDirectoryArgument = relative(repositoryRoot, socketDirectoryPath);
  assert.equal(resolve(repositoryRoot, socketDirectoryArgument), socketDirectoryPath);
  mkdirSync(socketDirectoryPath, { mode: 0o700 });
  const sessions = new Map<string, string>();
  const daemonPids = new Set<number>();
  const daemonRecords = new Map<number, INativeReactDaemonRecord>();
  let sequence: number = 0;
  const run = async (
    targetId: string,
    label: string,
    argumentsList: string[],
    shouldConfigureProvider: boolean = true,
  ): Promise<string> => {
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
      ...(shouldConfigureProvider ? ["-p", "native-react-owned"] : []),
      ...argumentsList,
    ];
    const prefix = resolve(outputPath, `${String(++sequence).padStart(3, "0")}-${label}`);
    await Bun.write(
      `${prefix}.command.json`,
      JSON.stringify({ command, cwd: repositoryRoot, socketDirectoryPath, socketDirectoryArgument }, null, 2),
    );
    const child = Bun.spawn(command, {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        TMPDIR: socketDirectoryPath,
        AGENT_BROWSER_SOCKET_DIR: socketDirectoryArgument,
      },
      timeout: 40_000,
      stdout: Bun.file(`${prefix}.stdout.log`),
      stderr: Bun.file(`${prefix}.stderr.log`),
    });
    const exit = await child.exited;
    // The pinned maintained daemon writes its own PID in this exclusive
    // socket namespace; retain it before the public close removes the file.
    const pidPath = resolve(socketDirectoryPath, "namespaces", namespace, "run", `${session}.pid`);
    const pidFile = Bun.file(pidPath);
    if (await pidFile.exists()) {
      const pid = (await pidFile.text()).trim();
      assert(/^[1-9][0-9]*$/.test(pid), "Owned agent-browser daemon PID is invalid.");
      daemonPids.add(Number(pid));
      daemonRecords.set(Number(pid), {
        pid: Number(pid),
        targetId,
        session,
        configurationPath,
        pidPath,
        socketDirectoryPath,
        namespace,
      });
    }
    await Bun.write(
      resolve(outputPath, "automation-daemon-inventory.json"),
      JSON.stringify(Array.from(daemonRecords.values()), null, 2),
    );
    await Bun.write(`${prefix}.exit`, `${exit}\n`);
    assert.equal(exit, 0, await Bun.file(`${prefix}.stderr.log`).text());
    return Bun.file(`${prefix}.stdout.log`).text();
  };
  return {
    run,
    stop: async (): Promise<void> => {
      const targets = await readNativeReactTargets(endpoint);
      const liveIds = new Set(targets.map((target) => target.id));
      const bindings = Array.from(sessions, ([targetId, configurationPath], index) => ({
        targetId,
        configurationPath,
        session: `t${index}`,
        isTargetPresent: liveIds.has(targetId),
      }));
      const processes = await readNativeReactOwnedProcesses(
        Array.from(sessions.values(), (path) => path.replace("-agent.json", "-provider.ts")),
      );
      await Bun.write(
        resolve(outputPath, "automation-before-stop.json"),
        JSON.stringify(
          { bindings, processes, daemons: Array.from(daemonRecords.values()), socketDirectoryPath },
          null,
          2,
        ),
      );
      const outcomes = await Promise.allSettled(
        bindings
          .filter((binding) => binding.isTargetPresent)
          .map((binding) => {
            assert(
              Array.from(daemonRecords.values()).some(
                (daemon) => daemon.targetId === binding.targetId && isNativeReactOwnedProcessAlive(daemon.pid),
              ),
              "Recorded session daemon must exist before public session close.",
            );
            // The pinned CLI sends an explicit launch before every -p action,
            // including close. Session teardown must not reprovision a target.
            return run(binding.targetId, "detach-automation", ["close"], false);
          }),
      );
      await Bun.write(
        resolve(outputPath, "automation-close-outcomes.json"),
        JSON.stringify(
          outcomes.map((outcome, index) => ({
            binding: bindings.filter((binding) => binding.isTargetPresent)[index],
            status: outcome.status,
            error: outcome.status === "rejected" ? String(outcome.reason) : null,
          })),
          null,
          2,
        ),
      );
      const goneTargetStops: unknown[] = [];
      for (const binding of bindings.filter((binding) => !binding.isTargetPresent)) {
        const pidFile = Bun.file(
          resolve(socketDirectoryPath, "namespaces", namespace, "run", `${binding.session}.pid`),
        );
        if (!(await pidFile.exists())) continue;
        const text = (await pidFile.text()).trim();
        assert(/^[1-9][0-9]*$/.test(text));
        const pid = Number(text);
        assert(daemonPids.has(pid), "Gone-target daemon was not recorded by this automation owner.");
        if (!isNativeReactOwnedProcessAlive(pid)) continue;
        const environment = (await Bun.file(`/proc/${pid}/environ`).text()).split("\0");
        const ownership = [
          `AGENT_BROWSER_SOCKET_DIR=${socketDirectoryArgument}`,
          `AGENT_BROWSER_NAMESPACE=${namespace}`,
          `AGENT_BROWSER_SESSION=${binding.session}`,
        ];
        for (const entry of ownership) assert(environment.includes(entry), "Gone-target daemon ownership changed.");
        const command = (await Bun.file(`/proc/${pid}/cmdline`).text()).replaceAll("\0", " ");
        // Its owning Page/window is gone: reconnecting the configured provider
        // cannot dispose that target. Stop only this recorded daemon resource.
        process.kill(pid, "SIGTERM");
        goneTargetStops.push({
          targetId: binding.targetId,
          session: binding.session,
          pid,
          command,
          ownership,
          signal: "SIGTERM",
        });
      }
      await Bun.write(
        resolve(outputPath, "automation-gone-target-stops.json"),
        JSON.stringify(goneTargetStops, null, 2),
      );
      await waitForNativeReactCondition("owned automation daemon and provider processes joined", async () =>
        [...daemonPids, ...processes.map((process) => process.pid)].every(
          (pid) => !isNativeReactOwnedProcessAlive(pid),
        ),
      );
      await rm(socketDirectoryPath, { recursive: true, force: true });
      await assert.rejects(lstat(socketDirectoryPath), { code: "ENOENT" });
      await Bun.write(
        resolve(outputPath, "automation-cleanup.json"),
        JSON.stringify(
          {
            namespace,
            socketDirectoryPath,
            outcomes,
            bindings,
            goneTargetStops,
            isSocketDirectoryAbsent: true,
            daemons: Array.from(daemonPids, (pid) => ({ pid, isAlive: isNativeReactOwnedProcessAlive(pid) })),
            processes: processes.map((process) => ({
              ...process,
              isAlive: isNativeReactOwnedProcessAlive(process.pid),
            })),
          },
          null,
          2,
        ),
      );
      for (const result of outcomes) assert.equal(result.status, "fulfilled", JSON.stringify(result));
    },
  };
}
