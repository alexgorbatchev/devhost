import { expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { startBuiltDevtoolsHost } from "./helpers";

const readLoad = (page: Page): Promise<number> => page.evaluate(() => performance.timeOrigin);
const askToReload = (page: Page): Promise<void> => page.evaluate(() => window.location.reload());

type PageScenario = (page: Page) => Promise<void>;

async function withPage(run: PageScenario): Promise<void> {
  const host = await startBuiltDevtoolsHost();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ env: host.browserEnvironment, headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(host.url);
    await page.getByRole("button", { name: "Hold Reloads" }).waitFor();
    await run(page);
  } finally {
    await browser?.close();
    await host.close();
  }
}

test("a script's reload is held by default and the notice gives it back", async () => {
  await withPage(async (page) => {
    const firstLoad = await readLoad(page);
    await askToReload(page);
    await page.getByText("Reload blocked", { exact: true }).waitFor();
    expect(await readLoad(page)).toBe(firstLoad);

    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await page.waitForFunction((load) => performance.timeOrigin !== load, firstLoad);
    await page.getByRole("button", { name: "Hold Reloads" }).waitFor();
    expect(await page.getByText("Reload blocked", { exact: true }).count()).toBe(0);
  });
}, 30_000);

test("a reload from the browser itself is never held", async () => {
  await withPage(async (page) => {
    const firstLoad = await readLoad(page);
    await page.reload();
    await page.getByRole("button", { name: "Hold Reloads" }).waitFor();
    expect(await readLoad(page)).not.toBe(firstLoad);
  });
}, 30_000);

test("turning the hold off lets reloads through and stays off", async () => {
  await withPage(async (page) => {
    await page.getByRole("button", { name: "Hold Reloads" }).click();
    const firstLoad = await readLoad(page);
    await page.evaluate(() => {
      setTimeout(() => window.location.reload(), 0);
    });
    await page.waitForFunction((load) => performance.timeOrigin !== load, firstLoad);
    const toggle = page.getByRole("button", { name: "Hold Reloads" });
    await toggle.waitFor();
    expect(await toggle.getAttribute("aria-pressed")).toBe("false");
  });
}, 30_000);
