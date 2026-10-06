import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright";
import { chromium } from "playwright";
import type { BrowserContext } from "playwright";
import tailwindPlugin from "bun-plugin-tailwind";

import type { INativeVueHost, INativeVueHostOptions, NativeVueHostTest } from "./fixtures/types";

const repositoryRoot = resolve(import.meta.dir, "../../../../../../..");

export async function startNativeVueHost(options: INativeVueHostOptions = {}): Promise<INativeVueHost> {
  const dependenciesPath = resolve(repositoryRoot, ".tmp/vue-native-host");
  await mkdir(dependenciesPath, { recursive: true });
  await Bun.write(
    resolve(dependenciesPath, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        vue: "3.5.43",
        vite: "8.3.3",
        "@vitejs/plugin-vue": "6.0.9",
        "vite-plugin-vue-devtools": "9.0.0-beta.1",
        "@vitejs/devtools": "0.7.6",
        "@vitejs/devtools-kit": "0.7.6",
        "@devframes/hub": "1.2.2",
        "@devframes/hub-ui": "1.2.2",
        devframe: "1.2.2",
      },
    }),
  );
  const install = Bun.spawn(["bun", "install"], {
    cwd: dependenciesPath,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  const [installOutput, installError, installExit] = await Promise.all([
    new Response(install.stdout).text(),
    new Response(install.stderr).text(),
    install.exited,
  ]);
  assert.equal(installExit, 0, installOutput + installError);
  const rootPath = resolve(dependenciesPath, "runs", crypto.randomUUID());
  const hostRootPath = resolve(rootPath, "host");
  await mkdir(hostRootPath, { recursive: true });
  const fixturePath = resolve(import.meta.dir, "fixtures/vueHost");
  for await (const filename of new Bun.Glob("*").scan(fixturePath))
    await Bun.write(resolve(hostRootPath, filename), Bun.file(resolve(fixturePath, filename)));
  const stylesheetPath = resolve(repositoryRoot, "packages/devhost-ui/src/devtools/shared/devtools.css");
  const stylesheet = await Bun.build({ entrypoints: [stylesheetPath], plugins: [tailwindPlugin], minify: true });
  assert(stylesheet.success);
  const css = stylesheet.outputs[0];
  assert(css);
  const bundle = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "fixtures/mountVueLauncherHarness.tsx")],
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    files: {
      [resolve(repositoryRoot, "packages/devhost-ui/src/devtools/shared/devtoolsCssText.ts")]:
        `export default ${JSON.stringify(await css.text())};`,
    },
  });
  assert(bundle.success, bundle.logs.map(String).join("\n"));
  const artifact = bundle.outputs[0];
  assert(artifact);
  await Bun.write(resolve(hostRootPath, "launcher.js"), artifact);
  const serverProcess = Bun.spawn(["bun", resolve(hostRootPath, "serve.mjs")], {
    cwd: hostRootPath,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "development",
      NATIVE_VUE_BASE: options.base,
      NATIVE_VUE_OPTIMIZE_DEPS: JSON.stringify(options.optimizedDependencies ?? []),
      NATIVE_VUE_VISIBILITY: options.visibility,
    },
  });
  let output = "";
  const { promise: ready, resolve: resolveReady } = Promise.withResolvers<string>();
  const { promise: authorizationCode, resolve: resolveAuthorizationCode } = Promise.withResolvers<string>();
  const consume = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += decoder.decode(chunk.value, { stream: true });
      const url = output.match(/FIXTURE_READY (http:\/\/[^\s]+)/)?.[1];
      if (url !== undefined) resolveReady(url);
      const code = Bun.stripANSI(output).match(/auth code\s+(\d{6})/)?.[1];
      if (code !== undefined) resolveAuthorizationCode(code);
    }
  };
  const consumed = Promise.all([consume(serverProcess.stdout), consume(serverProcess.stderr)]);
  const close = async (): Promise<void> => {
    if (serverProcess.exitCode === null) serverProcess.kill("SIGTERM");
    await serverProcess.exited;
    await consumed;
    await Bun.write(resolve(rootPath, "server.log"), redactNativeOutput(output));
    await rm(resolve(rootPath, "profile"), { recursive: true, force: true });
  };
  try {
    const url = await withNativeDeadline(
      Promise.race([
        ready,
        serverProcess.exited.then((code) => {
          assert.fail(`Native Vue host exited ${code}: ${redactNativeOutput(output)}`);
        }),
      ]),
      "Native Vue host startup",
    );
    const controlUrl = output.match(/FIXTURE_CONTROL (http:\/\/[^\s]+)/)?.[1];
    assert(controlUrl);
    return {
      url,
      rootPath,
      controlUrl,
      readAuthorizationCode: () => withNativeDeadline(authorizationCode, "Native Vue authorization code"),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function withNativeVueHosts(
  options: readonly INativeVueHostOptions[],
  run: NativeVueHostTest,
): Promise<void> {
  const hosts: INativeVueHost[] = [];
  let browser: BrowserContext | undefined;
  try {
    for (const hostOptions of options) hosts.push(await startNativeVueHost(hostOptions));
    const first = hosts[0];
    assert(first);
    browser = await chromium.launchPersistentContext(`${first.rootPath}/profile`, {
      headless: true,
      artifactsDir: `${first.rootPath}/artifacts`,
    });
    await run(hosts, browser);
  } finally {
    try {
      await browser?.close();
    } finally {
      const results = await Promise.allSettled(hosts.map((host) => host.close()));
      for (const result of results) assert.equal(result.status, "fulfilled", JSON.stringify(result));
    }
  }
}

async function withNativeDeadline<Value>(promise: Promise<Value>, operation: string): Promise<Value> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Value>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${operation} timed out after 30000ms`)), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function redactNativeOutput(output: string): string {
  return Bun.stripANSI(output)
    .replace(/(auth code\s+)\d{6}/g, "$1[redacted]")
    .replace(/devframe_otp=\d{6}/g, "devframe_otp=[redacted]");
}

export async function authorizeNativeVueHost(page: Page, host: INativeVueHost): Promise<void> {
  // Finish the native initial trust handshake before opening its authorization view.
  await page.waitForFunction(() => window.nativeVueFixture?.readContext()?.connection.status === "unauthorized");
  await page.getByRole("button", { name: "Unauthorized", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "Digit 1 of 6", exact: true }).waitFor();
  const code = await host.readAuthorizationCode();
  await page.getByRole("textbox", { name: "Digit 1 of 6", exact: true }).pressSequentially(code, { delay: 30 });
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
}

export async function revealNativeVueHost(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      window.nativeVueFixture?.readContext() !== undefined &&
      customElements.get("devframes-dock-embedded") !== undefined,
  );
  if (await page.evaluate(() => window.nativeVueFixture.readContext().panel.state.state === "hidden"))
    await page.keyboard.press("Alt+Shift+D");
  await page.locator("devframes-dock-embedded").waitFor({ state: "attached" });
}
