import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Browser, CDPSession } from "playwright";
import { chromium } from "playwright";
import { createOwnedBrowserEnvironment } from "../../../../../../test-support/createOwnedBrowserEnvironment";
import { viewport } from "../../constants";
import { createDemoPage } from "../../createDemoPage";
import { createDemoRuntime } from "../../createDemoRuntime";
import type { IDemoRuntime } from "../../types";

// The contents of a 1280 × 720 headed window under its tab strip and toolbar. Headless windows have no decorations, so
// launching at this size gives the window the contents it would have when it appears on a desktop.
const appearedHeight = 633;
const captureScale = 2;
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
  "window-manager-test.localhost",
);
const runtime: IDemoRuntime = { ...fixtureRuntime, url: server.url.href };
let browser: Browser | undefined;
let reverts = 0;

// Plays a window manager that, as AeroSpace does when it floats a new window, puts the window back to the size it had
// when it appeared once something else has resized it. It acts once per window.
async function restoreAppearedSize(windowManager: CDPSession, targetId: string): Promise<void> {
  const { windowId } = await windowManager.send("Browser.getWindowForTarget", { targetId });
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const { bounds } = await windowManager.send("Browser.getWindowBounds", { windowId });
    if (bounds.height !== appearedHeight) {
      await windowManager.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width: viewport.width, height: appearedHeight },
      });
      reverts += 1;
      return;
    }
    await Bun.sleep(5);
  }
}

try {
  browser = await chromium.launch({
    env: await createOwnedBrowserEnvironment(process.cwd()),
    args: [`--force-device-scale-factor=${captureScale}`, `--window-size=${viewport.width},${appearedHeight}`],
  });
  const windowManager = await browser.newBrowserCDPSession();
  const managedWindows: Promise<void>[] = [];
  windowManager.on("Target.targetCreated", ({ targetInfo }) => {
    if (targetInfo.type === "page") managedWindows.push(restoreAppearedSize(windowManager, targetInfo.targetId));
  });
  await windowManager.send("Target.setDiscoverTargets", { discover: true });
  const page = await createDemoPage(browser, runtime, captureScale);
  await Promise.all(managedWindows);
  const pageSize = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
  console.log(JSON.stringify({ reverts, page: pageSize }));
} finally {
  await browser?.close();
  await server.stop(true);
  await rm(runtime.directoryPath, { recursive: true, force: true });
}
