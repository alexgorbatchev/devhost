import { afterEach, describe, expect, mock, test } from "bun:test";
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
  test("loads the production bundle, caches static assets and refreshes configuration", async () => {
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
      await page.goto(`${host.url}second`);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() =>
          String(Reflect.get(Reflect.get(globalThis, "__DEVHOST_INJECTED_CONFIG__"), "stackName")),
        ),
      ).toBe("second-instance");
      expect(host.requests.filter((path) => path === "/__devhost__/config.json").length).toBe(2);
      expect(host.requests.filter((path) => path === "/__devhost__/inject.js").length).toBe(1);
      expect(host.requests.filter((path) => path.endsWith(".woff2")).length).toBe(fontRequests);
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
