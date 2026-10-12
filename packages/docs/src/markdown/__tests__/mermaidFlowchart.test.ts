import assert from "node:assert";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import rehypeMermaid from "rehype-mermaid";
import { unified } from "unified";

import { createOwnedBrowserEnvironment } from "../../../../../test-support/createOwnedBrowserEnvironment";
import { MERMAID_RENDER_OPTIONS } from "../../theme/constants";
import { rehypeWrapMermaidDiagrams } from "../rehypeWrapMermaidDiagrams";

const stylesPath = resolve(import.meta.dir, "../../styles");
const flowchart = [
  "flowchart TD",
  '    subgraph films["Guide films, by hand"]',
  '        audio["just demo audio-guides<br/>generate the narration"] --> upload["just docs publish-media"]',
  "    end",
  '    upload --> review{"Approved?"}',
].join("\n");

let browser: Browser;
let runDirectoryPath: string;

beforeAll(async () => {
  const parentPath: string = resolve(import.meta.dir, "../../../../../.tmp/docs-mermaid-tests");

  await mkdir(parentPath, { recursive: true });
  runDirectoryPath = await mkdtemp(join(parentPath, "browser-"));
  browser = await chromium.launch({ env: await createOwnedBrowserEnvironment(runDirectoryPath) });
});

afterAll(async () => {
  await browser.close();
  await rm(runDirectoryPath, { recursive: true, force: true });
});

async function renderFlowchart(): Promise<string> {
  const tree: Root = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "pre",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "code",
            properties: { className: ["language-mermaid"] },
            children: [{ type: "text", value: flowchart }],
          },
        ],
      },
    ],
  };

  return toHtml(await unified().use(rehypeMermaid, MERMAID_RENDER_OPTIONS).use(rehypeWrapMermaidDiagrams).run(tree));
}

describe("Mermaid flowcharts", () => {
  it("gives every label, of one line or two, the room its text takes in the docs font", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      // The page is opened from the styles directory so the font files the stylesheet names resolve.
      await page.goto(`file://${join(stylesPath, "docsFontTheme.css")}`);
      await page.setContent(
        `<!doctype html><html><head><link rel="stylesheet" href="docsFontTheme.css"><link rel="stylesheet" href="devhostContent.css"></head><body><div class="sl-markdown-content">${await renderFlowchart()}</div></body></html>`,
      );
      await page.evaluate(async (): Promise<void> => {
        await Promise.all(Array.from(document.fonts, (font) => font.load()));
      });
      // A label drawn as HTML inside the SVG is clipped to the size Mermaid measured, and its line breaks are doubled
      // when the page is serialized. Labels are SVG text instead, which must fit the shape drawn around it.
      const labels = await page.locator("g.node").evaluateAll((nodes) =>
        nodes.map((node) => {
          const shape = node.querySelector("rect, polygon, path")?.getBoundingClientRect();
          const label = node.querySelector("g.label")?.getBoundingClientRect();

          return {
            lines: Array.from(node.querySelectorAll("tspan.text-outer-tspan"), (line) => line.textContent?.trim()),
            isInsideShape:
              shape !== undefined &&
              label !== undefined &&
              label.left >= shape.left &&
              label.right <= shape.right &&
              label.top >= shape.top &&
              label.bottom <= shape.bottom,
          };
        }),
      );

      expect(await page.locator("foreignObject").count()).toBe(0);
      expect(labels.map((label) => label.lines)).toContainEqual(["just demo audio-guides", "generate the narration"]);
      expect(labels.filter((label) => !label.isInsideShape)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("centers a diagram narrower than the column", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`file://${join(stylesPath, "docsFontTheme.css")}`);
      await page.setContent(
        `<!doctype html><html><head><link rel="stylesheet" href="devhostContent.css"></head><body><div class="sl-markdown-content">${await renderFlowchart()}</div></body></html>`,
      );
      const column = await page.locator(".dh-diagram-scroll").evaluate((scroll) => {
        const style = getComputedStyle(scroll);

        return {
          left: scroll.getBoundingClientRect().left + Number.parseFloat(style.paddingLeft),
          right: scroll.getBoundingClientRect().right - Number.parseFloat(style.paddingRight),
        };
      });
      const diagram = await page.locator(".dh-diagram-scroll svg").boundingBox();
      assert(diagram);

      expect(diagram.width).toBeLessThan(column.right - column.left);
      expect(Math.abs(diagram.x - column.left - (column.right - diagram.x - diagram.width))).toBeLessThanOrEqual(1);
    } finally {
      await page.close();
    }
  }, 60_000);
});
