import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "playwright";
import { clickWithIndicator } from "./clickWithIndicator";
import type { ChangeCaption, IDemoRuntime } from "./types";

export async function recordAnnotations(
  page: Page,
  runtime: IDemoRuntime,
  signal: AbortSignal,
  changeCaption: ChangeCaption,
): Promise<void> {
  const heading = page.getByRole("heading", { name: "Devtools playground", exact: true });
  await heading.waitFor();
  await page.waitForTimeout(2_000);
  await page.keyboard.down("Alt");
  try {
    await heading.hover();
    await page.waitForTimeout(1_500);
    await clickWithIndicator(page, heading);
  } finally {
    await page.keyboard.up("Alt");
  }
  await page.getByRole("dialog", { name: "Annotation draft", exact: true }).waitFor();
  const comment = page.getByRole("textbox", { name: "Annotation comment", exact: true });
  await comment.pressSequentially(
    "Change #1 to 'Local domains. Live fixes.' Replace the subtitle with 'Alt-click. Describe it. Watch Pi fix it.'",
    { delay: 25 },
  );
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: join(runtime.directoryPath, "annotation-draft.png") });
  await clickWithIndicator(page, page.getByRole("button", { name: "Pi", exact: true }));
  await clickWithIndicator(page, page.getByRole("button", { name: /^Pi terminal, / }));
  await page.getByTestId("TerminalSessionPanel--content").waitFor();
  await page
    .getByTestId("TerminalSessionPanel--header")
    .getByText("working", { exact: true })
    .waitFor({ timeout: 60_000 });
  await changeCaption("Pi is working on the annotated change.");
  const headingUpdated = page
    .getByRole("heading", { name: "Local domains. Live fixes.", exact: true })
    .waitFor({ timeout: 120_000 })
    .then(async (): Promise<void> => {
      await changeCaption("The heading updates live from Pi's source edit.");
    });
  const showPi = async (): Promise<void> => {
    await Promise.race([page.waitForTimeout(4_000), headingUpdated]);
    await page.screenshot({ path: join(runtime.directoryPath, "pi-working.png") });
    await clickWithIndicator(page, page.getByRole("button", { name: "Minimize", exact: true }));
  };
  await Promise.all([headingUpdated, showPi()]);
  signal.throwIfAborted();
  await page.getByText("Alt-click. Describe it. Watch Pi fix it.", { exact: true }).waitFor();
  const source = await Bun.file(
    join(runtime.directoryPath, "playground/frontend/src/components/PlaygroundLayout.tsx"),
  ).text();
  assert(source.includes("Local domains. Live fixes."), "Pi did not edit the real playground source");
  await page.getByRole("button", { name: "Pi terminal, idle", exact: true }).waitFor({ timeout: 120_000 });
  await page.screenshot({ path: join(runtime.directoryPath, "pi-live-fix.png") });
  await page.waitForTimeout(6_000);
}
