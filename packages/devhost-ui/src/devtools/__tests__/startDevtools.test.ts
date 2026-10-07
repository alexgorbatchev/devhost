import { afterEach, describe, expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser } from "playwright";

import { startDevtools } from "../startDevtools";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../shared/constants";
import { startBuiltDevtoolsHost } from "./helpers";

const originalConfiguration: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

afterEach(() => {
  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, originalConfiguration);
});

describe("startDevtools", () => {
  test("does not create a terminal connection when its panel closes before xterm finishes loading", async () => {
    const host = await startBuiltDevtoolsHost();
    host.restoreTerminal();
    host.delayTerminalRuntime();
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ env: host.browserEnvironment, headless: true });
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const errors: Error[] = [];
      page.on("pageerror", (error) => errors.push(error));
      const requestedRuntime = page.waitForRequest((request) => request.url().includes("/assets/xterm-"));
      await page.goto(host.url);
      const request = await requestedRuntime;
      await page.getByTestId("TerminalSessionChip").getByRole("button").click();
      await page.getByRole("button", { name: "Terminate", exact: true }).click();
      await page.getByTestId("TerminalSessionPanel").waitFor({ state: "detached" });
      host.releaseTerminalRuntime();
      await page.evaluate(async (url) => {
        await import(url);
        await new Promise(requestAnimationFrame);
      }, request.url());
      expect(host.requests.filter((path) => path === "/__devhost__/ws/terminal").length).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await host.close();
    }
  }, 30_000);

  test("reports a failed terminal download without an unhandled error or terminal connection", async () => {
    const host = await startBuiltDevtoolsHost();
    host.restoreTerminal();
    host.failTerminalRuntime();
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ env: host.browserEnvironment, headless: true });
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const errors: Error[] = [];
      page.on("pageerror", (error) => errors.push(error));
      await page.goto(host.url);
      await page.getByTestId("TerminalSessionChip").getByRole("button").click();
      await page.getByTestId("TerminalSessionPanel--error").waitFor();
      assert(await page.getByTestId("TerminalSessionPanel--error").textContent());
      expect(host.requests.filter((path) => path === "/__devhost__/ws/terminal").length).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await host.close();
    }
  }, 30_000);

  test("loads the production bundle, caches static assets, refreshes configuration, and defers xterm until a session exists", async () => {
    const host = await startBuiltDevtoolsHost();
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ env: host.browserEnvironment, headless: true });
      const page = await browser.newPage();
      const errors: Error[] = [];
      page.on("pageerror", (error) => errors.push(error));
      await page.goto(host.url);
      page.setDefaultTimeout(5000);
      await page.locator("#devhost-devtools-host").waitFor({ state: "attached" });
      await page.getByText("bundle-browser-test", { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      expect(host.requests.filter((path) => path.includes("/assets/xterm-")).length).toBe(0);
      expect(host.requests.filter((path) => path.endsWith(".woff2")).length).toBeGreaterThan(0);
      const fontRequests: number = host.requests.filter((path) => path.endsWith(".woff2")).length;
      host.setStackName("second-instance");
      host.restoreTerminal();
      await page.goto(`${host.url}second`);
      await page.getByTestId("TerminalSessionChip").getByRole("button").click();
      await page.getByRole("dialog", { name: "Neovim terminal" }).waitFor();
      await page.locator(".xterm-rows").filter({ hasText: "lazy terminal ready" }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() =>
          String(Reflect.get(Reflect.get(globalThis, "__DEVHOST_INJECTED_CONFIG__"), "stackName")),
        ),
      ).toBe("second-instance");
      expect(host.requests.filter((path) => path === "/__devhost__/config.json").length).toBe(2);
      expect(host.requests.filter((path) => path === "/__devhost__/inject.js").length).toBe(1);
      expect(host.requests.filter((path) => path.endsWith(".woff2")).length).toBe(fontRequests);
      expect(host.requests.filter((path) => path.includes("/assets/xterm-")).length).toBe(1);
      expect(host.requestUrls.filter((url) => url.startsWith("/__devhost__/ws/terminal"))).toEqual([
        "/__devhost__/ws/terminal?sessionId=restored-session",
      ]);
      expect(host.requestHeaders.every((headers) => !headers.has("x-devhost-control-token"))).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await host.close();
    }
  }, 30_000);
  test("waits for fresh configuration before mounting", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetchConfiguration = mock(() => pending.promise);
    const mount = mock(() => {
      expect(Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME)).toEqual({ stackName: "fresh-stack" });
    });
    const startup = startDevtools(fetchConfiguration, mount);
    expect(fetchConfiguration).toHaveBeenCalledWith("/__devhost__/config.json", { cache: "no-store" });
    expect(mount).not.toHaveBeenCalled();
    pending.resolve(Response.json({ stackName: "fresh-stack" }));
    await startup;
    expect(mount).toHaveBeenCalledTimes(1);
  });

  test("refuses to mount when the configuration endpoint fails", async () => {
    const mount = mock();
    await expect(startDevtools(() => Promise.resolve(new Response(null, { status: 503 })), mount)).rejects.toThrow(
      "Failed to load devhost configuration (503).",
    );
    expect(mount).not.toHaveBeenCalled();
  });

  test.each([null, {}, { stackName: "" }, { stackName: 42 }])(
    "rejects invalid configuration %j",
    async (configuration) => {
      const mount = mock();
      await expect(startDevtools(() => Promise.resolve(Response.json(configuration)), mount)).rejects.toThrow(
        "Received invalid devhost configuration.",
      );
      expect(mount).not.toHaveBeenCalled();
    },
  );

  test("propagates connection failures without mounting", async () => {
    const mount = mock();
    const error = new Error("Connection closed.");
    await expect(startDevtools(() => Promise.reject(error), mount)).rejects.toBe(error);
    expect(mount).not.toHaveBeenCalled();
  });
});
