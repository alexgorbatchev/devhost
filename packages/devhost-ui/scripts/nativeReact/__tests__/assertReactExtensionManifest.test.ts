import { expect, test } from "bun:test";
import { assertReactExtensionManifest } from "../assertReactExtensionManifest";

const manifest = {
  version: "8.0.0",
  devtools_page: "main.html",
  background: { service_worker: "build/background.js" },
};

test("accepts React Developer Tools 8.0.0 and every newer release with the same entry points", () => {
  for (const version of ["8.0.0", "8.0.1", "8.1", "9.0.0.2"]) {
    expect(assertReactExtensionManifest({ ...manifest, version })).toBe(version);
  }
});

test("rejects an older release or a manifest without the DevTools page and service worker devhost drives", () => {
  expect(() => assertReactExtensionManifest({ ...manifest, version: "7.0.1" })).toThrow(
    "React Developer Tools 7.0.1 is older than 8.0.0",
  );
  expect(() => assertReactExtensionManifest({ ...manifest, devtools_page: "devtools.html" })).toThrow();
  expect(() => assertReactExtensionManifest({ ...manifest, background: { service_worker: "worker.js" } })).toThrow();
});
