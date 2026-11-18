import assert from "node:assert/strict";
import { join } from "node:path";
import type { Browser, CDPSession, Page } from "playwright";
import { viewport } from "./constants";
import type { IDemoRuntime } from "./types";

const contentsSizeAttempts = 4;
const contentsSizeAttemptMs = 3_000;
const contentsSizeTotalMs = 15_000;
// How long the requested size must hold before the window counts as sized. A window manager that puts a new window
// back to the size it read when the window appeared does so shortly after the recorder resizes it.
const contentsSizeSettleMs = 1_000;

// Requests the capture size for the browser contents until the page reports it and keeps it. A window manager can
// re-apply an earlier size after the request: AeroSpace restores the size it read on detection when it floats a
// window. A resize away from the requested size, or no matching size within an attempt, starts the next request.
// Running out of attempts or time returns, and the caller's size guard reports the window's actual size.
async function fitContentsSize(page: Page, session: CDPSession): Promise<void> {
  const { windowId } = await session.send("Browser.getWindowForTarget");
  const deadline = performance.now() + contentsSizeTotalMs;
  for (let attempt = 0; attempt < contentsSizeAttempts; attempt += 1) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) return;
    await session.send("Browser.setContentsSize", { windowId, ...viewport });
    const isHeld = await page.evaluate(
      ({ width, height, settleMs, timeoutMs }) =>
        new Promise<boolean>((resolve) => {
          const observation = new AbortController();
          let settleTimer: ReturnType<typeof setTimeout> | undefined;
          let hasMatched = false;
          const finish = (isSized: boolean): void => {
            observation.abort();
            clearTimeout(settleTimer);
            resolve(isSized);
          };
          const observe = (): void => {
            clearTimeout(settleTimer);
            if (innerWidth === width && innerHeight === height) {
              hasMatched = true;
              settleTimer = setTimeout(() => finish(true), settleMs);
            } else if (hasMatched) {
              finish(false);
            }
          };
          AbortSignal.timeout(timeoutMs).addEventListener("abort", () => finish(false), {
            signal: observation.signal,
          });
          addEventListener("resize", observe, { signal: observation.signal });
          observe();
        }),
      { ...viewport, settleMs: contentsSizeSettleMs, timeoutMs: Math.min(contentsSizeAttemptMs, remainingMs) },
    );
    if (isHeld) return;
  }
}

export async function createDemoPage(browser: Browser, runtime: IDemoRuntime, captureScale: number = 1): Promise<Page> {
  const context = await browser.newContext({
    // A scaled capture keeps the window launchDemoBrowser sized: an emulated viewport would reset its device scale.
    ...(captureScale === 1 ? { viewport, deviceScaleFactor: 1 } : { viewport: null }),
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const onPageError = (error: Error): void => {
    errors.push(error.message);
  };
  page.on("pageerror", onPageError);
  try {
    page.setDefaultTimeout(15_000);
    if (captureScale !== 1) {
      // Size actual browser contents: headed window decorations are outside the captured viewport.
      const session = await context.newCDPSession(page);
      try {
        await fitContentsSize(page, session);
      } finally {
        await session.detach();
      }
    }
    const response = await page.goto(runtime.url, { waitUntil: "domcontentloaded" });
    await Bun.write(
      join(runtime.directoryPath, "browser-response.json"),
      JSON.stringify({
        url: response?.url(),
        status: response?.status(),
        body: response?.ok() ? undefined : await response?.text(),
      }),
    );
    assert(response?.ok(), "The playground did not load through devhost");
    assert.deepEqual(
      await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      })),
      { ...viewport, devicePixelRatio: captureScale },
      "The recording window does not have the capture size",
    );
    await page.getByRole("main").waitFor();
    await page.getByRole("button", { name: "Services: 2 of 2 up", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const animations = await page.evaluate(() => {
      const logo = document.querySelector(".react-logo");
      if (!logo) throw new Error("The React logo is missing");
      return {
        background: getComputedStyle(document.body, "::before").animationName,
        reactLogo: getComputedStyle(logo).animationName,
      };
    });
    assert.deepEqual(animations, { background: "none", reactLogo: "none" }, "Playground animations must be disabled");
    assert.deepEqual(errors, [], "The recording page raised JavaScript errors during setup");
    return page;
  } catch (error) {
    await page.screenshot({ path: join(runtime.directoryPath, "browser-setup-failure.png") }).catch(() => {});
    await context.close();
    throw error;
  } finally {
    page.off("pageerror", onPageError);
  }
}
