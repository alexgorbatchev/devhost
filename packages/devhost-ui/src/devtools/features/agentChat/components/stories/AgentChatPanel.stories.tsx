import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { userEvent as nativeUserEvent } from "vitest/browser";
import { AgentChatPanel } from "../AgentChatPanel";
import { ChatPreparationScene, PageChatScene, installPageChatCatalog } from "./helpers";

const meta: Meta<typeof AgentChatPanel> = {
  component: AgentChatPanel,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/AgentChatPanel",
  render: () => <PageChatScene />,
  beforeEach: installPageChatCatalog,
  parameters: {
    viewport: {
      options: {
        chatMobile: { name: "Mobile chat", styles: { width: "320px", height: "568px" }, type: "mobile" },
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const PreparingSendKeepsConversationTarget: Story = {
  render: () => <ChatPreparationScene />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await canvas.findByRole("option", { name: "Discovered Codex model" });
    await userEvent.keyboard("{Escape}");
    const composer = await canvas.findByRole("textbox");
    await userEvent.type(composer, "Keep my target while sharing");
    await userEvent.click(canvas.getByRole("button", { name: "Send Message" }));
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await expect(canvas.getByRole("combobox", { name: "Harness" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "Model" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "Conversation" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "New Conversation" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Cancel capture" }));
    await expect(composer).toHaveValue("Keep my target while sharing");
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await expect(canvas.getByRole("button", { name: "New Conversation" })).toBeEnabled();
  },
};

export const DiscoveredHarnessAndModel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await canvas.findByRole("option", { name: "Discovered Codex model" });
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Model" }), "codex-discovered");
    await expect(canvas.getByRole("combobox", { name: "Model" })).toHaveValue("codex-discovered");
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Harness" }), "claude-code");
    await canvas.findByRole("option", { name: "Discovered Claude model" });
    await expect(canvas.queryByRole("option", { name: "Discovered Codex model" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("combobox", { name: "Model" })).toHaveValue("");
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Model" }), "claude-discovered");
    await expect(canvas.getByRole("combobox", { name: "Model" })).toHaveValue("claude-discovered");
  },
};

export const ComposerDraftSurvivesCollapse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.type(canvas.getByRole("textbox"), "Keep this draft while I inspect the page");
    await userEvent.click(canvas.getByRole("button", { name: "Collapse Chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await expect(canvas.getByRole("textbox")).toHaveValue("Keep this draft while I inspect the page");
  },
};

export const ComposerStaysAtPanelBottom: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    const panel = canvas.getByRole("complementary", { name: "Agent chat" });
    const composer = await within(panel).findByRole("textbox");
    const send = within(panel).getByRole("button", { name: "Send Message" });
    expect(panel.getBoundingClientRect().bottom - send.getBoundingClientRect().bottom).toBeLessThan(100);
    await userEvent.type(composer, "Review the selected element");
    expect(panel.getBoundingClientRect().bottom - send.getBoundingClientRect().bottom).toBeLessThan(100);
  },
};

export const HostFontSizeDoesNotResizeChat: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    const chat = canvas.getByRole("complementary", { name: "Agent chat" });
    const width = chat.getBoundingClientRect().width;
    const originalSize = document.documentElement.style.fontSize;
    try {
      document.documentElement.style.fontSize = "32px";
      expect(chat.getBoundingClientRect().width).toBe(width);
      await expect(canvas.getByRole("textbox")).toBeVisible();
    } finally {
      document.documentElement.style.fontSize = originalSize;
    }
  },
};

export const ClientNavigationPreservesChat: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const originalURL = window.location.href;
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
      await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
      await canvas.findByRole("option", { name: "Discovered Codex model" });
      await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Harness" }), "claude-code");
      await canvas.findByRole("option", { name: "Discovered Claude model" });
      await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Model" }), "claude-discovered");
      await userEvent.keyboard("{Escape}");
      await userEvent.type(await canvas.findByRole("textbox"), "Keep my page review");
      const nextURL = new URL(originalURL);
      nextURL.searchParams.set("page", "details");
      window.history.replaceState(window.history.state, "", nextURL);
      await userEvent.click(canvas.getByRole("button", { name: "Collapse Chat" }));
      await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
      await expect(canvas.getByRole("textbox")).toHaveValue("Keep my page review");
      await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
      await expect(canvas.getByRole("combobox", { name: "Harness" })).toHaveValue("claude-code");
      await expect(canvas.getByRole("combobox", { name: "Model" })).toHaveValue("claude-discovered");
      await userEvent.keyboard("{Escape}");
      await expect(canvas.getByRole("textbox")).toHaveValue("Keep my page review");
    } finally {
      window.history.replaceState(window.history.state, "", originalURL);
    }
  },
};

export const MobileControlsRemainReachable: Story = {
  globals: { viewport: { value: "chatMobile", isRotated: false } },
  play: async ({ canvasElement }) => {
    expect(window.innerWidth).toBe(320);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    const panel = canvas.getByRole("complementary", { name: "Agent chat" });
    const composer = await within(panel).findByRole("textbox");
    const controls = within(panel).getByRole("region", { name: "Chat settings and page context" });
    const bounds = panel.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    expect(composer.getBoundingClientRect().height).toBeGreaterThan(0);
    for (const button of within(panel)
      .getAllByRole("button")
      .filter((button) => !controls.contains(button))) {
      const rectangle = button.getBoundingClientRect();
      expect(rectangle.left).toBeGreaterThanOrEqual(bounds.left);
      expect(rectangle.right).toBeLessThanOrEqual(bounds.right);
      expect(rectangle.top).toBeGreaterThanOrEqual(bounds.top);
      expect(rectangle.bottom, button.outerHTML).toBeLessThanOrEqual(bounds.bottom);
    }
    await nativeUserEvent.click(canvas.getByRole("button", { name: "Box" }));
    const box = canvas.getByRole("button", { name: "Box" });
    await expect(box).toHaveAttribute("aria-pressed", "true");
    expect(box.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      canvas.getByRole("toolbar", { name: "Page Annotation Tools" }).getBoundingClientRect().bottom,
    );
    const drawing = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await nativeUserEvent.dragAndDrop(drawing, drawing, {
      sourcePosition: { x: 20, y: 90 },
      targetPosition: { x: 90, y: 150 },
    });
    await canvas.findByRole("region", { name: "Page context" });
    expect(
      within(panel).getByRole("button", { name: "Send Message" }).getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(bounds.bottom);
    await userEvent.click(canvas.getByRole("button", { name: "Collapse Chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
  },
};
