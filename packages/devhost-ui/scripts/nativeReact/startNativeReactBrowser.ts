import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { readNativeReactTargets } from "./readNativeReactTargets";
import { waitForNativeReactCondition } from "./waitForNativeReactCondition";
import { stopNativeReactProcess } from "./stopNativeReactProcess";
import type { INativeReactBrowser } from "./types";

interface INativeReactBrowserOptions {
  chromeExecutablePath: string;
  reactExtensionDirectoryPath: string;
  outputPath: string;
  repositoryRoot: string;
}

export async function startNativeReactBrowser(options: INativeReactBrowserOptions): Promise<INativeReactBrowser> {
  const profilePath = resolve(options.outputPath, "profile");
  await mkdir(profilePath, { recursive: true });
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
  const child = Bun.spawn(command, {
    cwd: options.repositoryRoot,
    env: { ...process.env, TMPDIR: ".tmp" },
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
        TMPDIR: ".tmp",
        resolvedTMPDIR: ".tmp",
        profilePath,
      },
      null,
      2,
    ),
  );
  const stop = async (): Promise<void> => {
    const exit = await stopNativeReactProcess(child);
    await rm(profilePath, { recursive: true, force: true });
    await Bun.write(
      resolve(options.outputPath, "browser-cleanup.json"),
      JSON.stringify(
        { pid: child.pid, exit, hasProfile: await Bun.file(resolve(profilePath, "DevToolsActivePort")).exists() },
        null,
        2,
      ),
    );
  };
  try {
    const portPath = resolve(profilePath, "DevToolsActivePort");
    await waitForNativeReactCondition("owned DevToolsActivePort", async () => {
      assert.equal(child.exitCode, null, "Owned browser exited before readiness.");
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
    await stop();
    throw error;
  }
}
