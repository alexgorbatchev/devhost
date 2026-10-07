import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import tailwindPlugin from "bun-plugin-tailwind";
import type { EnhancedStore } from "@redux-devtools/instrument";
import type { Action } from "redux";
import type { registerReduxDevtoolsStore, registerZustandDevtoolsStore } from "../index";

const repositoryRoot: string = resolve(import.meta.dir, "../../../../../../..");

export async function withNativeReduxHost(options: INativeReduxHostOptions, run: NativeReduxHostTest): Promise<void> {
  const rootPath = resolve(repositoryRoot, ".tmp/redux-native-host", crypto.randomUUID());
  await mkdir(rootPath, { recursive: true });
  // Run the genuine bundler in its normal process, isolated from Bun's in-test module resolver.
  const build = Bun.spawn(["bun", import.meta.path], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    env: { ...process.env, DEVHOST_REDUX_NATIVE_BUILD_ROOT: rootPath },
  });
  const [buildOutput, buildError, buildExit] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ]);
  await Bun.write(resolve(rootPath, "build.log"), buildOutput + buildError);
  assert.equal(buildExit, 0, buildOutput + buildError);
  const bundles = new Map<string, Blob>([
    ["/host.js", Bun.file(resolve(rootPath, "host.js"))],
    ["/launcher.js", Bun.file(resolve(rootPath, "launcher.js"))],
    ["/__devhost__/redux-monitor.js", Bun.file(resolve(rootPath, "redux-monitor.js"))],
    ["/__devhost__/redux.js", Bun.file(resolve(rootPath, "redux.js"))],
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const bundle = bundles.get(path);
      if (bundle !== undefined) return new Response(bundle, { headers: { "Content-Type": "text/javascript" } });
      if (path === "/unrelated")
        return new Response("<!doctype html><html><body>Unrelated native page</body></html>", {
          headers: { "Content-Type": "text/html" },
        });
      if (path === "/__devhost__/redux")
        return new Response(
          '<!doctype html><html><head><title>Native Redux fixture</title><style>html,body,#redux-monitor{height:100%;margin:0}</style></head><body><div id="redux-monitor"></div><script type="module" src="/__devhost__/redux-monitor.js"></script></body></html>',
          { headers: { "Content-Type": "text/html" } },
        );
      const headers = new Headers({ "Content-Type": "text/html" });
      if (new URL(request.url).searchParams.get("popup") === "blocked")
        headers.set("Content-Security-Policy", "sandbox allow-scripts allow-same-origin");
      return new Response(
        '<!doctype html><html><body><div id="devhost-fixture"></div><button id="unmount-devhost">Unmount devhost</button><button id="mount-devhost">Mount devhost</button><script type="module" src="/host.js"></script>' +
          (new URL(request.url).searchParams.get("ui") === "shipped"
            ? ""
            : '<script type="module" src="/launcher.js"></script>') +
          "</body></html>",
        { headers },
      );
    },
  });
  let browser: BrowserContext | undefined;
  const runtimeErrors: string[] = [];
  const close = async (): Promise<void> => {
    await server.stop(true);
  };
  try {
    const extensionPath = options.isExtensionEnabled ? await loadNativeReduxExtension() : undefined;
    const browserTempDirectoryPath = relative(process.cwd(), resolve(repositoryRoot, ".tmp"));
    assert.equal(resolve(process.cwd(), browserTempDirectoryPath), resolve(repositoryRoot, ".tmp"));
    // Chromium cancels a download when its default download directory, Downloads in the home directory, does not
    // exist, as on a fresh CI runner. An owned home supplies it and keeps the browser out of the real one.
    const browserHomePath = resolve(rootPath, "home");
    await mkdir(resolve(browserHomePath, "Downloads"), { recursive: true });
    await Bun.write(
      resolve(rootPath, "browser-environment.json"),
      JSON.stringify({
        cwd: process.cwd(),
        HOME: browserHomePath,
        TMPDIR: browserTempDirectoryPath,
        resolvedTempDirectoryPath: resolve(process.cwd(), browserTempDirectoryPath),
      }) + "\n",
    );
    browser = await chromium.launchPersistentContext(resolve(rootPath, "profile"), {
      channel: "chromium",
      headless: true,
      ignoreHTTPSErrors: options.hasUntrustedFixtureCertificate ?? false,
      artifactsDir: resolve(rootPath, "artifacts"),
      // Native controls fail with the absolute TMPDIR here and pass with this relative path to the same owned directory.
      env: {
        ...process.env,
        HOME: browserHomePath,
        XDG_CONFIG_HOME: resolve(browserHomePath, ".config"),
        TMPDIR: browserTempDirectoryPath,
      },
      args:
        extensionPath === undefined
          ? []
          : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const observe = (page: Page): void => {
      page.on("pageerror", (error) => runtimeErrors.push(`${page.url()}: ${error.message}`));
    };
    browser.pages().forEach(observe);
    browser.on("page", observe);
    await run({ url: server.url.href, rootPath, close }, browser);
  } finally {
    const snapshots = await Promise.allSettled(
      (browser?.pages() ?? []).map(async (page, index) => {
        await Bun.write(resolve(rootPath, `page-${index}.snapshot`), await page.locator("body").ariaSnapshot());
        await page.screenshot({ path: resolve(rootPath, `page-${index}.png`) });
      }),
    );
    try {
      await browser?.close();
    } finally {
      await close();
      await rm(resolve(rootPath, "profile"), { recursive: true, force: true });
      await Bun.write(resolve(rootPath, "runtime-errors.json"), JSON.stringify(runtimeErrors, null, 2) + "\n");
      await Bun.write(
        resolve(rootPath, "cleanup.json"),
        JSON.stringify({ isBrowserClosed: true, isServerStopped: true, port: server.port }) + "\n",
      );
    }
    for (const snapshot of snapshots) assert.equal(snapshot.status, "fulfilled", JSON.stringify(snapshot));
    assert.deepEqual(runtimeErrors, []);
  }
}

async function buildNativeReduxAssets(rootPath: string): Promise<void> {
  const stylesheet = await Bun.build({
    entrypoints: [resolve(repositoryRoot, "packages/devhost-ui/src/devtools/shared/devtools.css")],
    plugins: [tailwindPlugin],
    minify: true,
  });
  assert(stylesheet.success);
  const css = stylesheet.outputs[0];
  assert(css);
  const cssText = await css.text();
  for (const [route, entrypoint] of [
    ["/host.js", resolve(import.meta.dir, "fixtures/host.ts")],
    ["/launcher.js", resolve(import.meta.dir, "fixtures/mountReduxLauncherHarness.tsx")],
    ["/__devhost__/redux-monitor.js", resolve(import.meta.dir, "../startReduxDevtoolsMonitor.ts")],
    ["/__devhost__/redux.js", resolve(import.meta.dir, "../index.ts")],
  ]) {
    assert(route);
    assert(entrypoint);
    const result = await Bun.build({
      entrypoints: [entrypoint],
      target: "browser",
      format: "esm",
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
      tsconfig: resolve(repositoryRoot, "packages/devhost-ui/tsconfig.json"),
      files: {
        [resolve(repositoryRoot, "packages/devhost-ui/src/devtools/shared/devtoolsCssText.ts")]:
          `export default ${JSON.stringify(cssText)};`,
      },
    });
    assert(result.success, result.logs.map(String).join("\n"));
    const bundle = result.outputs[0];
    assert(bundle);
    await Bun.write(resolve(rootPath, route.split("/").at(-1) ?? "asset.js"), bundle);
  }
}

async function loadNativeReduxExtension(): Promise<string> {
  const directoryPath = resolve(repositoryRoot, ".tmp/redux-native-extension-3.2.10");
  await mkdir(directoryPath, { recursive: true });
  const archivePath = resolve(directoryPath, "chrome.zip");
  const archive = Bun.file(archivePath);
  if (!(await archive.exists())) {
    const response = await fetch(
      "https://github.com/reduxjs/redux-devtools/releases/download/remotedev-redux-devtools-extensions%403.2.10/chrome.zip",
    );
    assert(response.ok, `Released extension download failed: ${response.status}`);
    await Bun.write(archivePath, response);
  }
  const bytes = await Bun.file(archivePath).arrayBuffer();
  assert.equal(
    Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex"),
    "4843f267bf99d9324b9f4d5d9e66c029662e18921929a6bc47a83adb241ccc6c",
  );
  const extensionPath = resolve(directoryPath, "extension");
  const extraction = Bun.spawn(["unzip", "-qo", archivePath, "-d", extensionPath], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(extraction.stdout).text(),
    new Response(extraction.stderr).text(),
    extraction.exited,
  ]);
  assert.equal(exit, 0, stdout + stderr);
  return extensionPath;
}

export async function selectReduxStore(page: Page, name: string): Promise<void> {
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name, exact: true }).click();
}

export async function openNativeReduxExtension(page: Page, browser: BrowserContext): Promise<Page> {
  await page.waitForFunction(() => typeof Reflect.get(window, "__REDUX_DEVTOOLS_EXTENSION__") === "function");
  const opened = browser.waitForEvent("page");
  await page.evaluate(() => {
    const hook: unknown = Reflect.get(window, "__REDUX_DEVTOOLS_EXTENSION__");
    if (typeof hook !== "function" || !("open" in hook) || typeof hook.open !== "function")
      throw new Error("Released native extension is unavailable.");
    hook.open("window");
  });
  return opened;
}

export async function waitForReduxHistoryIndex(page: Page, index: number): Promise<void> {
  await page.waitForFunction((expectedIndex) => {
    const slider = document.querySelector('input[type="range"]');
    return slider instanceof HTMLInputElement && slider.value === String(expectedIndex);
  }, index);
}

if (import.meta.main) {
  const rootPath = process.env.DEVHOST_REDUX_NATIVE_BUILD_ROOT;
  assert(rootPath);
  await buildNativeReduxAssets(rootPath);
}

export interface INativeReduxHost {
  url: string;
  rootPath: string;
  close: () => Promise<void>;
}
export interface INativeReduxHostOptions {
  isExtensionEnabled?: boolean;
  hasUntrustedFixtureCertificate?: boolean;
}
export type NativeReduxHostTest = (host: INativeReduxHost, browser: BrowserContext) => Promise<void>;
export interface ICounterFixtureState {
  count: number;
  increment: () => void;
}
export interface ICounterFixtureSnapshot {
  count: number;
}
export interface IRichCounterFixtureSnapshot extends ICounterFixtureSnapshot {
  createdAt: Date;
  values: Map<string, number>;
  flags: Set<string>;
  optional: undefined;
  self?: IRichCounterFixtureSnapshot;
}
export interface IReduxFixture {
  store: EnhancedStore<ICounterFixtureSnapshot, Action<string>, unknown>;
  increment: () => Action<string>;
}
export interface INativeReduxFixtureReadResult {
  toolkit: number[];
  zustand: number[];
  hasActions: boolean[];
  isHookUnchanged: boolean;
  hasNativeZustandMiddleware: boolean[];
  toolkitActionIds: number[][];
  isZustandBoundStore: boolean[];
  hasOriginalActions: boolean[];
}
export interface INativeReduxFixture {
  read: () => INativeReduxFixtureReadResult;
  register: () => void;
  unregister: () => void;
  registerInvalid: () => void;
  replace: () => void;
  openExtension: () => void;
}
export interface IReduxHostRegistrationApi {
  registerReduxDevtoolsStore: typeof registerReduxDevtoolsStore;
  registerZustandDevtoolsStore: typeof registerZustandDevtoolsStore;
}
declare global {
  interface Window {
    reduxNativeFixture: INativeReduxFixture;
  }
}
