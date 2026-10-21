import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "playwright";
import { clickWithIndicator } from "./clickWithIndicator";
import type { ChangeCaption, IDemoRuntime, MarkPoster } from "./types";

export async function recordAnnotations(
  page: Page,
  runtime: IDemoRuntime,
  signal: AbortSignal,
  changeCaption: ChangeCaption,
  markPoster: MarkPoster,
): Promise<void> {
  assert.equal(
    runtime.env.DEVHOST_DEMO_INTERACTIVE,
    "1",
    "This scene needs an operator to share the current tab and review native requests",
  );
  const heading = page.getByRole("heading", { name: "Devtools playground", exact: true });
  await heading.waitFor();
  await page.keyboard.down("Alt");
  try {
    await clickWithIndicator(page, heading);
  } finally {
    await page.keyboard.up("Alt");
  }
  const chat = page.getByRole("complementary", { name: "Agent chat", exact: true });
  await chat.waitFor();
  await clickWithIndicator(page, chat.getByRole("button", { name: "Chat Settings", exact: true }));
  const settings = page.getByRole("dialog", { name: "Chat Settings", exact: true });
  await settings.getByRole("combobox", { name: "Harness", exact: true }).selectOption("codex");
  await settings.getByRole("combobox", { name: "Model", exact: true }).selectOption("");
  await page.keyboard.press("Escape");
  const sourcePath = runtime.env.DEVHOST_DEMO_EDIT_FILE;
  assert(sourcePath);
  await chat
    .getByPlaceholder("Send a message...", { exact: true })
    .fill(
      `This is an isolated recording fixture. Edit only ${sourcePath}. Change the heading 'Devtools playground' to 'Local domains. Live fixes.' Preserve all other source, imports, JSX and attributes. Do not run commands, install dependencies, or commit. Describe the edit briefly.`,
    );
  markPoster();
  await page.screenshot({ path: join(runtime.directoryPath, "annotation-draft.png") });
  console.log(
    "Choose this current tab in the browser sharing picker. Review native requests in chat; the recorder never approves them.",
  );
  await clickWithIndicator(page, chat.getByRole("button", { name: "Send Message", exact: true }));
  await chat.getByRole("status").filter({ hasText: "codex · running" }).waitFor({ timeout: 180_000 });
  await changeCaption("Codex is working on the selected page context.");
  await page.screenshot({ path: join(runtime.directoryPath, "agent-working.png") });
  await page.getByRole("heading", { name: "Local domains. Live fixes.", exact: true }).waitFor({ timeout: 180_000 });
  signal.throwIfAborted();
  assert(
    (await Bun.file(sourcePath).text()).includes("Local domains. Live fixes."),
    "The native agent did not edit the copied playground source",
  );
  await changeCaption("The heading updates live from the source edit.");
  await chat.getByRole("status").filter({ hasText: "codex · idle" }).waitFor({ timeout: 180_000 });
  await clickWithIndicator(page, chat.getByRole("button", { name: "Collapse Chat", exact: true }));
  await page.screenshot({ path: join(runtime.directoryPath, "agent-live-fix.png") });
  await page.waitForTimeout(6_000);
}
