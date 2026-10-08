import { E2E_TEMPORARY_PATH } from "../../../../test-support/constants";
import assert from "node:assert/strict";
import { lstat, mkdir, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { readNativeReactTargets } from "./readNativeReactTargets";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";
import { stopNativeReactProcess } from "./stopNativeReactProcess";
import type { INativeReactBrowser } from "./types";
import type { Subprocess } from "bun";
import { isNativeReactOwnedProcessAlive, readNativeReactOwnedProcesses } from "./readNativeReactOwnedProcesses";

interface INativeReactBrowserOptions {
  chromeExecutablePath: string;
  reactExtensionDirectoryPath: string;
  outputPath: string;
  repositoryRoot: string;
}

export async function startNativeReactBrowser(options: INativeReactBrowserOptions): Promise<INativeReactBrowser> {
  const profilePath = resolve(options.outputPath, "profile");
  const runtimePath = resolve(options.outputPath, "browser-runtime");
  const temporaryPath = resolve(E2E_TEMPORARY_PATH, `nb-${crypto.randomUUID().slice(0, 8)}`);
  // Chrome's crashpad database ignores --user-data-dir on Linux. Its documented
  // config override and XDG consumers must share this run's owned lifetime.
  const configurationDirectories = {
    CHROME_CONFIG_HOME: resolve(runtimePath, "chrome-config"),
    XDG_CONFIG_HOME: resolve(runtimePath, "config"),
    XDG_CACHE_HOME: resolve(runtimePath, "cache"),
    XDG_DATA_HOME: resolve(runtimePath, "data"),
    XDG_STATE_HOME: resolve(runtimePath, "state"),
    XDG_RUNTIME_DIR: resolve(temporaryPath, "runtime"),
  };
  const environment = {
    ...configurationDirectories,
    // Preserved validation contrasts absolute-TMPDIR SIGTRAP with owned relative
    // success; the cause is unverified. The fixed cwd resolves this owned path.
    TMPDIR: relative(options.repositoryRoot, temporaryPath),
  };
  const command = [
    options.chromeExecutablePath,
    "--headless=new",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profilePath}`,
    `--load-extension=${options.reactExtensionDirectoryPath}`,
    `--disable-extensions-except=${options.reactExtensionDirectoryPath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--ignore-certificate-errors",
    "about:blank",
  ];
  let child: Subprocess | null = null;
  const stop = async (): Promise<void> => {
    const processes = await readNativeReactOwnedProcesses([profilePath, runtimePath, temporaryPath]);
    if (child !== null) processes.unshift({ pid: child.pid, command: command.join(" ") });
    await Bun.write(
      resolve(options.outputPath, "browser-processes-before-stop.json"),
      JSON.stringify(processes, null, 2),
    );
    const exit = child === null ? null : await stopNativeReactProcess(child);
    await waitForNativeReactCondition("owned Chrome and crashpad processes joined", async () =>
      processes.every((owned) => !isNativeReactOwnedProcessAlive(owned.pid)),
    );
    const directories = [profilePath, runtimePath, temporaryPath];
    await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
    const directoryStates = await Promise.all(
      directories.map(async (path) => {
        await assert.rejects(lstat(path), { code: "ENOENT" });
        return { path, isAbsent: true };
      }),
    );
    await Bun.write(
      resolve(options.outputPath, "browser-cleanup.json"),
      JSON.stringify(
        {
          pid: child?.pid,
          exit,
          hasProfile: false,
          processes: processes.map((owned) => ({ ...owned, isAlive: isNativeReactOwnedProcessAlive(owned.pid) })),
          directoryStates,
        },
        null,
        2,
      ),
    );
  };
  try {
    await Promise.all(
      Object.values(configurationDirectories).map((path) => mkdir(path, { recursive: true, mode: 0o700 })),
    );
    await mkdir(profilePath, { recursive: true });
    child = Bun.spawn(command, {
      cwd: options.repositoryRoot,
      env: { ...process.env, ...environment },
      stdout: Bun.file(resolve(options.outputPath, "chrome.stdout.log")),
      stderr: Bun.file(resolve(options.outputPath, "chrome.stderr.log")),
    });
    await Bun.write(
      resolve(options.outputPath, "browser-owned.json"),
      JSON.stringify(
        {
          command,
          pid: child.pid,
          cwd: options.repositoryRoot,
          environment,
          resolvedTMPDIR: temporaryPath,
          profilePath,
        },
        null,
        2,
      ),
    );
    const current = child;
    const portPath = resolve(profilePath, "DevToolsActivePort");
    await waitForNativeReactCondition("owned DevToolsActivePort", async () => {
      assert.equal(current.exitCode, null, "Owned browser exited before readiness.");
      return Bun.file(portPath).exists();
    });
    const port = (await Bun.file(portPath).text()).split("\n")[0];
    assert(port && /^[0-9]+$/.test(port));
    const endpoint: string = `http://127.0.0.1:${port}`;
    let extensionId: string = "";
    await waitForNativeReactCondition("original installed extension worker", async () => {
      const workers = (await readNativeReactTargets(endpoint)).filter(
        (target) =>
          target.type === "service_worker" &&
          /^chrome-extension:\/\/[a-p]{32}\/build\/background\.js$/.test(target.url),
      );
      if (workers.length !== 1) return false;
      const worker = workers[0];
      assert(worker);
      extensionId = new URL(worker.url).hostname;
      return true;
    });
    await Bun.write(
      resolve(options.outputPath, "browser-ready.json"),
      JSON.stringify({ endpoint, extensionId, targets: await readNativeReactTargets(endpoint) }, null, 2),
    );
    return { endpoint, extensionId, profilePath, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Owned browser startup and cleanup failed.");
    }
    throw error;
  }
}
