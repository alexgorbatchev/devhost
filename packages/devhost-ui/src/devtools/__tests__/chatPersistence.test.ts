import { expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { fixture_runningChatSnapshot, fixture_savedChatSnapshot } from "./fixtures";
import { chooseChatSetting, startBuiltDevtoolsHost, waitForChatScroll } from "./helpers";

test("client navigation and reload keep the open chat and its selected conversation", async () => {
  const host = await startBuiltDevtoolsHost(fixture_savedChatSnapshot);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ env: host.browserEnvironment, headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(host.url);
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.getByRole("button", { name: "Chat Settings" }).click();
    await chooseChatSetting(page, "Conversation", "codex · saved-conversation");
    await page.keyboard.press("Escape");
    await page.getByText("codex · idle", { exact: true }).waitFor();
    await page.getByRole("textbox").fill("Continue this conversation after navigation");
    // A host router changes its URL without remounting the injected devtools.
    await page.evaluate(() => window.history.pushState(null, "", "/details?view=review#context"));
    await page.reload();
    const chat = page.getByRole("button", { name: "Chat", exact: true });
    await chat.waitFor();
    expect(await chat.getAttribute("aria-expanded")).toBe("true");
    await page.getByText("codex · idle", { exact: true }).waitFor();
    expect(await page.getByRole("textbox").inputValue()).toBe("Continue this conversation after navigation");
    await page.getByRole("button", { name: "Chat Settings" }).click();
    await page
      .getByRole("combobox", { name: "Conversation" })
      .getByText("codex · saved-conversation", { exact: true })
      .waitFor();
    expect(host.chatCommands).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Send Message" }).click();
    await page.getByText("Continued in saved-conversation", { exact: true }).waitFor();
    expect(host.chatCommands).toHaveLength(1);
    expect(JSON.parse(String(host.chatCommands[0]))).toMatchObject({
      type: "send",
      text: "Continue this conversation after navigation",
    });
    expect(host.requestMethods.every((method) => method === "GET")).toBe(true);
  } finally {
    await browser?.close();
    await host.close();
  }
}, 30_000);

test.each([fixture_savedChatSnapshot, fixture_runningChatSnapshot])(
  "the compiled chat restores an idle or running session view across actual page reloads",
  async (snapshot) => {
    const host = await startBuiltDevtoolsHost(snapshot);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ env: host.browserEnvironment, headless: true });
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const errors: Error[] = [];
      page.on("pageerror", (error) => errors.push(error));
      await page.goto(host.url);
      await page.getByRole("button", { name: "Chat", exact: true }).click();
      await page.getByRole("button", { name: "Chat Settings" }).click();
      await chooseChatSetting(page, "Model", "Native model");
      await chooseChatSetting(page, "Conversation", "codex · saved-conversation");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Move Chat To Left" }).click();
      await page.getByRole("textbox").fill("Keep this unsent review after reload");
      const viewport = page.locator('[data-slot="aui_thread-viewport"]');
      await viewport.hover();
      await page.mouse.wheel(0, -100000);
      await waitForChatScroll(page, 0);
      await page.mouse.wheel(0, 400);
      await waitForChatScroll(page, 400);
      await page.getByRole("button", { name: "Collapse Chat" }).click();
      await page.reload();
      const chat = page.getByRole("button", { name: "Chat", exact: true });
      await chat.waitFor();
      expect(await chat.getAttribute("aria-expanded")).toBe("false");
      await chat.click();
      await page.getByRole("button", { name: "Move Chat To Right" }).waitFor();
      await page.getByRole("textbox").waitFor();
      expect(await page.getByRole("textbox").inputValue()).toBe("Keep this unsent review after reload");
      await waitForChatScroll(page, 400);
      await page.getByRole("button", { name: "Chat Settings" }).click();
      await page
        .getByRole("combobox", { name: "Conversation" })
        .getByText("codex · saved-conversation", { exact: true })
        .waitFor();
      await page.getByRole("combobox", { name: "Model" }).getByText("Native model", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.reload();
      await chat.waitFor();
      expect(await chat.getAttribute("aria-expanded")).toBe("true");
      await waitForChatScroll(page, 400);
      expect(host.chatCommands).toEqual([]);
      expect(host.requestMethods.every((method) => method === "GET")).toBe(true);
      await page.getByRole("button", { name: "Close Conversation" }).click();
      await page.getByRole("button", { name: "Close Conversation" }).waitFor({ state: "hidden" });
      const connections = host.requestUrls.filter((url) => url.startsWith("/__devhost__/ws/chat?")).length;
      await page.reload();
      await chat.waitFor();
      await page.getByRole("textbox").waitFor();
      expect(await page.getByRole("textbox").inputValue()).toBe("Keep this unsent review after reload");
      expect(host.requestUrls.filter((url) => url.startsWith("/__devhost__/ws/chat?")).length).toBe(connections);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await host.close();
    }
  },
  30_000,
);
