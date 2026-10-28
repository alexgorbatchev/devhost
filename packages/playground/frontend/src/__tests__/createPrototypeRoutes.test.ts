import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { PROTOTYPES } from "../constants";
import { createPrototypeRoutes } from "../createPrototypeRoutes";

const DESIGN_DIRECTORY = new URL("../../../../design/", import.meta.url);

describe("createPrototypeRoutes", () => {
  test("serves every listed prototype from the design package as HTML", async () => {
    const routes = createPrototypeRoutes(DESIGN_DIRECTORY);

    for (const prototype of PROTOTYPES) {
      const response = routes[prototype.path]?.();

      expect(response?.headers.get("content-type")).toStartWith("text/html");
      expect(await response?.text()).toBe(await Bun.file(new URL(prototype.file, DESIGN_DIRECTORY)).text());
    }
  });

  test("serves each local stylesheet linked by a prototype", async () => {
    const routes = createPrototypeRoutes(DESIGN_DIRECTORY);

    for (const prototype of PROTOTYPES) {
      const document = routes[prototype.path]?.();
      assert(document);
      const stylesheets: string[] = [];
      await new HTMLRewriter().on('link[rel="stylesheet"]', {
        element(element) {
          const href = element.getAttribute("href");
          assert(href);
          stylesheets.push(href);
        },
      }).transform(document).text();

      expect(stylesheets.length).toBeGreaterThan(0);
      for (const href of stylesheets.filter(
        (href) => new URL(href, "http://playground.localhost").origin === "http://playground.localhost",
      )) {
        const stylesheetPath = new URL(href, new URL(prototype.path, "http://playground.localhost")).pathname;
        const response = routes[stylesheetPath]?.();

        expect(response?.headers.get("content-type")).toStartWith("text/css");
        expect(await response?.text()).toBe(
          await Bun.file(new URL(href, new URL(prototype.file, DESIGN_DIRECTORY))).text(),
        );
      }
    }
  });

  test("reads a prototype again on each request so edits show on reload", async () => {
    const designDirectory = new URL(`../../../../../.tmp/prototype-routes-${Bun.randomUUIDv7()}/`, import.meta.url);
    const prototype = PROTOTYPES[0];
    if (!prototype) throw new Error("No prototypes are listed");
    const prototypeFile = Bun.file(new URL(prototype.file, designDirectory));
    const routes = createPrototypeRoutes(designDirectory);

    try {
      await Bun.write(prototypeFile, "<p>first</p>");
      expect(await routes[prototype.path]?.().text()).toBe("<p>first</p>");
      await Bun.write(prototypeFile, "<p>second</p>");
      expect(await routes[prototype.path]?.().text()).toBe("<p>second</p>");
    } finally {
      await Bun.$`rm -rf ${Bun.fileURLToPath(designDirectory)}`;
    }
  });
});
