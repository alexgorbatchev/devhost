import assert from "node:assert/strict";
import type { Locator, Page } from "playwright";

export async function clickWithIndicator(page: Page, target: Locator): Promise<void> {
  const rectangle = await target.boundingBox();
  assert(rectangle, "The click target has no visible bounds");
  const x = rectangle.x + rectangle.width / 2;
  const y = rectangle.y + rectangle.height / 2;
  await page.mouse.move(x, y, { steps: 12 });
  await page.screencast.showOverlay(
    `<div aria-hidden="true" style="position:fixed;left:${x - 22}px;top:${y - 22}px;` +
      "width:44px;height:44px;border:4px solid #ffcc66;border-radius:50%;box-sizing:border-box;" +
      'background:#ffcc6633;box-shadow:0 0 0 3px #171717;pointer-events:none"></div>',
    { duration: 800 },
  );
  await target.click();
  await page.waitForTimeout(850);
}
