import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "playwright";
import type { ChangeCaption, IDemoRuntime } from "./types";

export async function recordReactHighlight(
  page: Page,
  runtime: IDemoRuntime,
  signal: AbortSignal,
  changeCaption: ChangeCaption,
): Promise<void> {
  const sourcePath = runtime.env.DEVHOST_DEMO_EDIT_FILE;
  assert(sourcePath);
  const sourceLines = (await Bun.file(sourcePath).text()).split("\n");
  await page.evaluate(() => {
    window.addEventListener("devhost:react-highlight", (event) => {
      if (event instanceof CustomEvent) document.documentElement.dataset.demoHighlight = JSON.stringify(event.detail);
    });
  });
  try {
    for (const [needle, caption, name] of [
      ["<h1>", "Publish the heading source locator. Its live DOM element is highlighted.", "heading"],
      ["<p>", "Publish another JSX locator. The browser highlight follows.", "paragraph"],
      ["<img src={logo}", "Source maps also connect JSX images to the live page.", "image"],
    ]) {
      signal.throwIfAborted();
      assert(needle && caption && name);
      const index = sourceLines.findIndex((line) => line.includes(needle));
      const line = sourceLines[index];
      assert(index >= 0 && line);
      const locator = `${sourcePath}:${index + 1}:${line.indexOf("<") + 1}`;
      const response = await page.request.post(`${runtime.url}/__devhost__/react-highlight/cursor`, {
        data: { locator },
        headers: { Origin: runtime.url },
      });
      assert(response.ok(), `Source locator publish failed: ${await response.text()}`);
      await page.waitForFunction((expected: string) => {
        const value = document.documentElement.dataset.demoHighlight;
        if (!value) return false;
        const detail: unknown = JSON.parse(value);
        return (
          typeof detail === "object" &&
          detail !== null &&
          "locator" in detail &&
          detail.locator === expected &&
          "matchedCount" in detail &&
          typeof detail.matchedCount === "number" &&
          detail.matchedCount > 0
        );
      }, locator);
      await page.locator("[data-devhost-react-highlight-overlay]").first().waitFor({ state: "visible" });
      await changeCaption(caption);
      await page.waitForTimeout(4_000);
      await page.screenshot({ path: join(runtime.directoryPath, `react-highlight-${name}.png`) });
    }
    const response = await page.request.post(`${runtime.url}/__devhost__/react-highlight/cursor`, {
      data: { locator: null },
      headers: { Origin: runtime.url },
    });
    assert(response.ok(), "Clearing the source highlight failed");
    await page.locator("[data-devhost-react-highlight-overlay]").waitFor({ state: "hidden" });
    await changeCaption("Clear the locator. Your page stays interactive.");
    await page.waitForTimeout(3_000);
  } finally {
    await Bun.write(
      join(runtime.directoryPath, "react-highlight-diagnostic.json"),
      await page.evaluate(() => document.documentElement.dataset.demoHighlight ?? "null"),
    );
  }
}
