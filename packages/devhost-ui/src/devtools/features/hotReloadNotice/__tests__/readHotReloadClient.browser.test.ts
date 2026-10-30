import { afterEach, assert, beforeEach, expect, test, vi } from "vitest";
import { readHotReloadClient } from "../readHotReloadClient";

let frame: HTMLIFrameElement;
let page: Window;

beforeEach(() => {
  frame = document.createElement("iframe");
  document.body.append(frame);
  assert(frame.contentWindow !== null, "The test frame has no window.");
  page = frame.contentWindow;
});

afterEach(() => {
  frame.remove();
});

function addScript(attribute: string): void {
  const script = page.document.createElement("script");
  script.setAttribute(attribute, "");
  page.document.head.append(script);
}

function addNextOverlay(): void {
  page.document.body.append(page.document.createElement("nextjs-portal"));
}

test("a page without a hot reload client has none", () => {
  addScript("data-some-other-script");
  expect(readHotReloadClient(page)).toBeNull();
});

test("Bun's development script names Bun", () => {
  addScript("data-bun-dev-server-script");
  expect(readHotReloadClient(page)).toBe("bun");
});

test("the Next.js overlay names Next.js, even over its webpack mode's global", () => {
  Reflect.set(page, "webpackHotUpdate_N_E", () => undefined);
  addNextOverlay();
  expect(readHotReloadClient(page)).toBe("next");
});

test("webpack's hot update global names webpack", () => {
  Reflect.set(page, "webpackHotUpdate_app", () => undefined);
  expect(readHotReloadClient(page)).toBe("webpack");
});

test("a loaded Vite client names Vite, under a base path too", async () => {
  await page.fetch(new URL("/base/@vite/client", window.location.href));
  await vi.waitFor(() => expect(readHotReloadClient(page)).toBe("vite"));
});
