import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "playwright";
import { clickWithIndicator } from "./clickWithIndicator";
import type { ChangeCaption, IDemoRuntime } from "./types";

export async function recordOverview(
  page: Page,
  runtime: IDemoRuntime,
  signal: AbortSignal,
  changeCaption: ChangeCaption,
): Promise<void> {
  await page.waitForTimeout(1_000);
  const minimap = page.getByTestId("LogMinimap");
  await minimap.waitFor();
  const rectangle = await minimap.boundingBox();
  assert(rectangle, "The log minimap has no visible bounds");
  await minimap.hover({ position: { x: 5, y: rectangle.height - 5 } });
  await page.getByTestId("LogMinimap--preview").waitFor();
  assert((await page.getByTestId("LogMinimap--preview-line").count()) > 0, "The minimap has no service output");
  await page.screenshot({ path: join(runtime.directoryPath, "minimap.png") });
  await page.waitForTimeout(4_000);
  await page.mouse.move(640, 360);
  await page.getByTestId("LogMinimap--preview").waitFor({ state: "hidden" });
  await changeCaption("Your stack and services are right in the toolbar.");
  const services = page.getByRole("button", { name: "Services: 2 of 2 up", exact: true });
  await clickWithIndicator(page, services);
  await page.getByRole("button", { name: "Restart api", exact: true }).waitFor();
  await page.waitForTimeout(3_000);
  signal.throwIfAborted();
  await clickWithIndicator(page, page.getByRole("button", { name: /^Choose worktree for / }));
  const picker = page.getByTestId("WorktreePicker");
  await picker.waitFor();
  await picker.getByRole("button", { name: "Refresh worktrees", exact: true, disabled: false }).waitFor();
  assert(
    (await picker.getByRole("radio", { disabled: false }).count()) > 1,
    "The worktree picker did not discover multiple usable checkouts",
  );
  await changeCaption("Browse your repository's worktrees without leaving the page.");
  await page.screenshot({ path: join(runtime.directoryPath, "worktrees.png") });
  await page.waitForTimeout(4_000);
  await clickWithIndicator(page, picker.getByRole("button", { name: "Cancel", exact: true }));
  await clickWithIndicator(page, services);
  await page.waitForTimeout(1_000);
}
