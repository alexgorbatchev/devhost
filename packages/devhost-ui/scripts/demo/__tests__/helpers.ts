import assert, { AssertionError } from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { createDemoPage } from "../createDemoPage";
import { createDemoRuntime } from "../createDemoRuntime";
import { recordBrowserScene } from "../recordBrowserScene";
import type { DemoRuntime } from "../types";

let documentRequests = 0;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request): Response => {
    if (new URL(request.url).pathname === "/") documentRequests += 1;
    return new Response(
      '<!doctype html><main><span class="react-logo">Ready</span><button>Services: 2 of 2 up</button><input aria-label="Recorded value"></main>',
      { headers: { "Content-Type": "text/html" } },
    );
  },
});
const fixtureRuntime = await createDemoRuntime(resolve(import.meta.dir, "../../../../.."), "recording-test.localhost");
const directoryPath = fixtureRuntime.directoryPath;
const runtime: DemoRuntime = {
  ...fixtureRuntime,
  url: server.url.href,
};
let browser: Browser | undefined;
try {
  browser = await chromium.launch();
  const page = await createDemoPage(browser, runtime);
  const signal = new AbortController().signal;
  const first = await recordBrowserScene(
    page,
    {
      id: "first",
      caption: "First scene",
      record: async (currentPage): Promise<void> => {
        await currentPage.getByRole("textbox", { name: "Recorded value" }).fill("Preserved between scenes");
      },
    },
    runtime,
    signal,
  );
  const second = await recordBrowserScene(
    page,
    {
      id: "second",
      caption: "Second scene",
      record: async (currentPage): Promise<void> => {
        assert.equal(
          await currentPage.getByRole("textbox", { name: "Recorded value" }).inputValue(),
          "Preserved between scenes",
        );
      },
    },
    runtime,
    signal,
  );
  const loadsBeforeReload = documentRequests;
  const retainedValue = await page.getByRole("textbox", { name: "Recorded value" }).inputValue();
  assert.equal(loadsBeforeReload, 1);
  assert.deepEqual(await Bun.file(join(directoryPath, "first-navigations.json")).json(), []);
  assert.deepEqual(await Bun.file(join(directoryPath, "second-navigations.json")).json(), []);
  let reloadError: unknown;
  try {
    await recordBrowserScene(
      page,
      {
        id: "reload",
        caption: "An intentional reload must fail",
        record: async (currentPage): Promise<void> => {
          await currentPage.reload();
        },
      },
      runtime,
      signal,
    );
  } catch (error) {
    reloadError = error;
  }
  assert(reloadError instanceof AssertionError);
  assert.deepEqual(reloadError.actual, [runtime.url]);
  assert.deepEqual(reloadError.expected, []);
  assert.equal(documentRequests, 2);
  const restarted = await page.screencast.start({ path: join(directoryPath, "raw/after-failure.webm") });
  await restarted.dispose();
  console.log(
    JSON.stringify({
      loadsBeforeReload,
      retainedValue,
      clips: first.length + second.length,
      rejectedReload: reloadError instanceof AssertionError,
    }),
  );
} finally {
  await browser?.close();
  await server.stop(true);
  await rm(directoryPath, { recursive: true, force: true });
}
