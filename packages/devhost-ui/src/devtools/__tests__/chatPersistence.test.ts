import { expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { fixture_runningChatSnapshot, fixture_savedChatSnapshot } from "./fixtures";
import { startBuiltDevtoolsHost, waitForChatScroll } from "./helpers";

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
      await page.getByRole("option", { name: "codex · saved-conversation" }).waitFor({ state: "attached" });
      await page.getByRole("combobox", { name: "Model" }).selectOption("native-model");
      await page.getByRole("combobox", { name: "Conversation" }).selectOption("saved-conversation");
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
      await page.getByRole("option", { name: "codex · saved-conversation" }).waitFor({ state: "attached" });
      expect(await page.getByRole("combobox", { name: "Conversation" }).inputValue()).toBe("saved-conversation");
      expect(await page.getByRole("combobox", { name: "Model" }).inputValue()).toBe("native-model");
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
