import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { provisionNativeReactAssets } from "./nativeReact/provisionNativeReactAssets";

// Starts the dedicated browser devhost's native React DevTools attach to: the current Stable Chrome for Testing with
// the current React Developer Tools, a profile of its own that persists between runs, and remote debugging on the
// given loopback port. It runs until the browser closes or the command is interrupted.
export async function startDevBrowser(port: number): Promise<number> {
  const repositoryRoot = resolve(import.meta.dir, "../../..");
  const browserPath = resolve(repositoryRoot, ".tmp/dev-browser");
  const endpoint = `http://127.0.0.1:${port}`;
  const isPortAnswering = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) }).then(
    (response) => response.ok,
    () => false,
  );
  if (isPortAnswering) throw new Error(`A browser already answers on ${endpoint}; close it or choose another port.`);

  const assets = await provisionNativeReactAssets(resolve(browserPath, "assets"), resolve(browserPath, "downloads"));
  const profilePath = resolve(browserPath, "profile");
  await mkdir(profilePath, { recursive: true });
  const child = Bun.spawn(
    [
      assets.chromeExecutablePath,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profilePath}`,
      `--load-extension=${assets.reactExtensionDirectoryPath}`,
      // macOS Chrome otherwise asks for the login keychain to encrypt this profile's cookies, once per launch.
      "--use-mock-keychain",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    { stdout: "ignore", stderr: Bun.file(resolve(browserPath, "chrome.log")) },
  );
  console.log(
    `Chrome for Testing ${assets.chromeVersion} with React Developer Tools ${assets.reactExtensionVersion} is ` +
      `running.\nSet DEVHOST_BROWSER_ENDPOINT="${endpoint}" (in .envrc.local) and restart \`just dev\` to attach to it.`,
  );
  const stop = (): void => {
    child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await child.exited;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? "9222");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${process.argv[2]}`);
  process.exitCode = await startDevBrowser(port);
}
