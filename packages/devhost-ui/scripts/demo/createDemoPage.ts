import assert from "node:assert/strict";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { viewport } from "./constants";
import type { IDemoRuntime } from "./types";

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
