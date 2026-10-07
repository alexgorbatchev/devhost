import type { Page } from "playwright";
import { clickWithIndicator } from "./clickWithIndicator";

export async function recordQuery(page: Page): Promise<void> {
  await page.waitForTimeout(1_500);
  await clickWithIndicator(page, page.getByRole("link", { name: "Query demo", exact: true }));
  await page.getByRole("heading", { name: "Backend query", exact: true }).waitFor();
  await page.getByLabel("Query response", { exact: true }).waitFor();
  await page.waitForTimeout(1_500);
  await clickWithIndicator(page, page.getByRole("button", { name: "Refetch query", exact: true }));
  await page.getByRole("button", { name: "Refetch query", exact: true, disabled: false }).waitFor();
  await clickWithIndicator(page, page.getByRole("button", { name: "Query", exact: true }));
  await page.getByRole("button", { name: "Query", exact: true, pressed: true }).waitFor();
  await page.locator(".tsqd-main-panel").waitFor({ state: "visible" });
  await page.waitForTimeout(5_000);
  await clickWithIndicator(page, page.getByRole("button", { name: "Query", exact: true }));
  await page.locator(".tsqd-main-panel").waitFor({ state: "hidden" });
  await page.waitForTimeout(3_000);
}
