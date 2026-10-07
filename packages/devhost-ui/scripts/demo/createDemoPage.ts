import assert from "node:assert/strict";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { viewport } from "./constants";
import type { DemoRuntime } from "./types";

export async function createDemoPage(browser: Browser, runtime: DemoRuntime): Promise<Page> {
  const context = await browser.newContext({
    viewport,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
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
    assert(response?.ok(), "The playground did not load through devhost");
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
