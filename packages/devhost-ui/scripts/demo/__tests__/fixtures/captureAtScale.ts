import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser } from "playwright";
import type { Subprocess } from "bun";
import assert from "node:assert/strict";
import { createOwnedBrowserEnvironment } from "../../../../../../test-support/createOwnedBrowserEnvironment";
import { createDemoPage } from "../../createDemoPage";
import { createDemoRuntime } from "../../createDemoRuntime";
import { launchDemoBrowser } from "../../launchDemoBrowser";
import { readMediaInfo } from "../../readMediaInfo";
import { recordBrowserScene } from "../../recordBrowserScene";
import { stopProcess } from "../../stopProcess";
import type { IDemoRuntime } from "../../types";

const captureScale = Number(process.argv[2]);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (): Response =>
    new Response(
      '<!doctype html><main><span class="react-logo">Ready</span><button>Services: 2 of 2 up</button></main>',
      { headers: { "Content-Type": "text/html" } },
    ),
});
const fixtureRuntime = await createDemoRuntime(
  resolve(import.meta.dir, "../../../../../.."),
  "capture-scale-test.localhost",
);
const runtime: IDemoRuntime = { ...fixtureRuntime, url: server.url.href };
let browser: Browser | undefined;
let displayServer: Subprocess | undefined;
try {
  const env = await createOwnedBrowserEnvironment(process.cwd());
  if (process.argv[3] === "true") {
    displayServer = Bun.spawn(["Xvfb", "-displayfd", "1", "-screen", "0", "3200x1800x24", "-nolisten", "tcp"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    assert(displayServer.stdout instanceof ReadableStream);
    const reader = displayServer.stdout.getReader();
    const display = new TextDecoder().decode((await reader.read()).value).trim();
    reader.releaseLock();
    assert(/^\d+$/.test(display), "Xvfb did not announce its owned display");
    env.DISPLAY = `:${display}`;
    env.DEVHOST_DEMO_INTERACTIVE = "1";
  }
  // The test that runs this script gives it a working directory of its own. The Xvfb display has no GPU.
  browser = await launchDemoBrowser(env, captureScale, displayServer === undefined);
  const page = await createDemoPage(browser, runtime, captureScale);
  const clips = await recordBrowserScene(
    page,
    {
      id: "scaled",
      caption: "Scaled capture",
      record: async (currentPage): Promise<void> => {
        await currentPage.mouse.move(200, 200);
        await currentPage.waitForTimeout(500);
      },
    },
    runtime,
    new AbortController().signal,
    captureScale,
  );
  const clip = clips[0];
  if (!clip) throw new Error("The scene recorded no clip");
  const video = await readMediaInfo(clip.path);
  const pageSize = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
  console.log(JSON.stringify({ video: { width: video.width, height: video.height }, page: pageSize }));
} finally {
  await browser?.close();
  if (displayServer) await stopProcess(displayServer);
  await server.stop(true);
  await rm(runtime.directoryPath, { recursive: true, force: true });
}
