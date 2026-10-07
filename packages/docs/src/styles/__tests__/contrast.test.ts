import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import type { Browser } from "playwright";

import { createOwnedBrowserEnvironment } from "../../../../../test-support/createOwnedBrowserEnvironment";
import { readContrastRatio } from "../../../../../test-support/readContrastRatio";
import type { IContrastTarget } from "../../../../../test-support/types";

let browser: Browser;
let runDirectoryPath: string;

beforeAll(async () => {
  const parentPath: string = resolve(import.meta.dir, "../../../../../.tmp/docs-contrast-tests");

  await mkdir(parentPath, { recursive: true });
  runDirectoryPath = await mkdtemp(join(parentPath, "browser-"));
  browser = await chromium.launch({ env: await createOwnedBrowserEnvironment(runDirectoryPath) });
});

afterAll(async () => {
  await browser.close();
  await rm(runDirectoryPath, { recursive: true, force: true });
});

describe("docs contrast", () => {
  it.each(["dark", "light"])("keeps prose links distinguishable in the %s theme", async (theme) => {
    const page = await browser.newPage();
    try {
      const styles = await Promise.all([
        Bun.file(new URL("../../../../design/tokens.css", import.meta.url)).text(),
        Bun.file(new URL("../devhostTokens.css", import.meta.url)).text(),
        Bun.file(new URL("../devhostContent.css", import.meta.url)).text(),
      ]);
      await page.setContent(`<html data-theme="${theme}"><style>${styles.join("\n")}</style>
        <body style="background:var(--dh-surface);color:var(--dh-fg)">
          <p class="sl-markdown-content">Read the <a href="#annotations">annotations guide</a>.</p>
        </body></html>`);
      const link = page.getByRole("link", { name: "annotations guide" });
      expect(await link.isVisible()).toBe(true);
      expect(
        await link.evaluate<number, IContrastTarget>(readContrastRatio, { property: "textDecorationColor" }),
      ).toBeGreaterThanOrEqual(3);
      await link.hover();
      expect(await link.evaluate(readContrastRatio, {})).toBeGreaterThanOrEqual(4.5);
    } finally {
      await page.close();
    }
  });

  it("keeps the light-theme search shortcut readable", async () => {
    const page = await browser.newPage();
    try {
      const styles = await Promise.all([
        Bun.file(new URL("../../../../design/tokens.css", import.meta.url)).text(),
        Bun.file(new URL("../devhostTokens.css", import.meta.url)).text(),
        Bun.file(new URL("../devhostChrome.css", import.meta.url)).text(),
      ]);
      await page.setContent(`<html data-theme="light"><style>${styles.join("\n")}</style>
        <body style="background:var(--dh-surface)">
          <site-search><button data-open-modal>Search <kbd>⌘K</kbd></button></site-search>
        </body></html>`);
      const shortcut = page.getByText("⌘K");
      expect(await shortcut.isVisible()).toBe(true);
      expect(await shortcut.evaluate(readContrastRatio, {})).toBeGreaterThanOrEqual(4.5);
    } finally {
      await page.close();
    }
  });
});
