import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { userEvent as nativeUserEvent } from "vitest/browser";
import { AgentChatPanel } from "../AgentChatPanel";
import {
  ChatPreparationScene,
  ChatReloadScene,
  InjectedChatScene,
  chooseChatSetting,
  PageChatScene,
  deliverChatReply,
  deliverChatStatus,
  isChatViewportAtBottom,
  installChatReloadServer,
  installChatTargetServer,
  installPageChatCatalog,
  readChatViewport,
  readOfferedConversations,
  readSentChatCommands,
} from "./helpers";
import {
  devtoolsStoryShadowRootHostTestId,
  readDevtoolsStoryShadowCanvas,
  readShadowRoot,
} from "../../../../shared/components/stories/helpers";

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

export const EscapeInInjectedComposerInterruptsTurn: Story = {
  render: () => <InjectedChatScene />,
  beforeEach: () => installChatReloadServer(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const shadowRoot = readShadowRoot(
      canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
      "The story did not attach a devtools shadow root.",
    );
    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Chat" }));
    await userEvent.click(shadowCanvas.getByRole("button", { name: "Chat Settings" }));
    await chooseChatSetting(shadowCanvas, "Conversation", "codex · saved-conversation");
    await userEvent.keyboard("{Escape}");
    await shadowCanvas.findByText("codex · idle");
    deliverChatStatus("running");
    await shadowCanvas.findByText("codex · running");
    const composer = shadowCanvas.getByRole("textbox", { name: "Message input" });
    await nativeUserEvent.click(composer);
    expect(shadowRoot.activeElement).toBe(composer);
    await nativeUserEvent.keyboard("{Escape}");
    await waitFor(() => expect(readSentChatCommands()).toContainEqual({ type: "interrupt" }));
  },
};

export const DirectoryToggleSwitchesToDevhostCheckout: Story = {
  render: () => <ChatReloadScene />,
  beforeEach: () => installChatTargetServer(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Chat" }));
    const directory = within(canvas.getByRole("group", { name: "Chat Directory" }));
    expect(directory.getByRole("button", { name: "Project" })).toHaveAttribute("aria-pressed", "true");
    expect(await readOfferedConversations(canvasElement)).toEqual(["New conversation", "codex · saved-conversation"]);

    await userEvent.click(directory.getByRole("button", { name: "devhost" }));
    expect(await readOfferedConversations(canvasElement)).toEqual(["New conversation", "codex · devhost-conversation"]);

    await userEvent.click(canvas.getByRole("button", { name: "Reload devtools" }));
    const reloaded = within(await canvas.findByRole("group", { name: "Chat Directory" }));
    expect(reloaded.getByRole("button", { name: "devhost" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(reloaded.getByRole("button", { name: "Project" }));
    expect(await readOfferedConversations(canvasElement)).toEqual(["New conversation", "codex · saved-conversation"]);
  },
};

export const DirectoryToggleNeedsDevhostCheckout: Story = {
  render: () => <ChatReloadScene />,
  beforeEach: () => installChatReloadServer(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Chat" }));
    await canvas.findByRole("complementary", { name: "Agent chat" });
    expect(canvas.queryByRole("group", { name: "Chat Directory" })).toBeNull();
  },
};

export const ReloadRestoresConversationView: Story = {
  render: () => <ChatReloadScene />,
  beforeEach: () => installChatReloadServer(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await chooseChatSetting(canvas, "Conversation", "codex · saved-conversation");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Move Chat To Left" }));
    const composer = await canvas.findByRole("textbox");
    await userEvent.type(composer, "Keep this unsent review");
    const viewport = readChatViewport(canvas.getByRole("complementary", { name: "Agent chat" }));
    await waitFor(() => expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight + 1000));
    await nativeUserEvent.wheel(viewport, { delta: { y: -100000 } });
    await waitFor(() => expect(viewport.scrollTop).toBe(0));
    await nativeUserEvent.wheel(viewport, { delta: { y: 400 } });
    await waitFor(() => expect(viewport.scrollTop).toBe(400));
    const position = viewport.scrollTop;
    await userEvent.click(canvas.getByRole("button", { name: "Collapse Chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Reload devtools" }));
    await expect(canvas.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Chat" }));
    await expect(canvas.getByRole("button", { name: "Move Chat To Right" })).toBeVisible();
    await expect(await canvas.findByRole("textbox")).toHaveValue("Keep this unsent review");
    const restored = readChatViewport(canvas.getByRole("complementary", { name: "Agent chat" }));
    await waitFor(() => expect(restored.scrollTop).toBeCloseTo(position, 0));
    await userEvent.click(canvas.getByRole("button", { name: "Reload devtools" }));
    await expect(canvas.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-expanded", "true");
    await expect(await canvas.findByRole("textbox")).toHaveValue("Keep this unsent review");
  },
};

export const RepliesFollowUntilReaderScrollsBack: Story = {
  render: () => <ChatReloadScene />,
  // The conversation starts empty, so the replies arriving live are what fill the view.
  beforeEach: () => installChatReloadServer([]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await chooseChatSetting(canvas, "Conversation", "codex · saved-conversation");
    await userEvent.keyboard("{Escape}");
    const viewport = readChatViewport(canvas.getByRole("complementary", { name: "Agent chat" }));
    for (let sequence = 1; sequence <= 40; sequence += 1) {
      deliverChatReply(sequence);
      await canvas.findByText(`Live reply ${sequence}.`);
      await waitFor(() => expect(isChatViewportAtBottom(viewport)).toBe(true));
    }
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight * 2);
    // A short step back, inside the space the composer's top margin filled while the conversation was short.
    await nativeUserEvent.wheel(viewport, { delta: { y: -150 } });
    await waitFor(() => expect(isChatViewportAtBottom(viewport)).toBe(false));
    // The reader keeps their place: what they were reading stays where it was on screen.
    const reading = canvas.getByText("Live reply 38.");
    const readingTop = reading.getBoundingClientRect().top;
    deliverChatReply(41);
    await canvas.findByText("Live reply 41.");
    expect(reading.getBoundingClientRect().top).toBeCloseTo(readingTop, 0);
    expect(isChatViewportAtBottom(viewport)).toBe(false);
    await nativeUserEvent.wheel(viewport, { delta: { y: 100000 } });
    await waitFor(() => expect(isChatViewportAtBottom(viewport)).toBe(true));
    deliverChatReply(42);
    await canvas.findByText("Live reply 42.");
    await waitFor(() => expect(isChatViewportAtBottom(viewport)).toBe(true));
  },
};

export const PreparingSendKeepsConversationTarget: Story = {
  render: () => <ChatPreparationScene />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Harness" })).toHaveTextContent("Codex"));
    await userEvent.keyboard("{Escape}");
    const composer = await canvas.findByRole("textbox");
    await userEvent.type(composer, "Keep my target while sharing");
    await userEvent.click(canvas.getByRole("button", { name: "Send Message" }));
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await expect(canvas.getByRole("combobox", { name: "Harness" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "Model" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "Conversation" })).toBeDisabled();
    await expect(within(canvas.getByRole("dialog")).queryByRole("button", { name: "New Conversation" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByRole("button", { name: "New Conversation" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Cancel capture" }));
    await expect(composer).toHaveValue("Keep my target while sharing");
    await expect(canvas.getByRole("button", { name: "New Conversation" })).toBeEnabled();
  },
};

export const DiscoveredHarnessAndModel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    const model = canvas.getByRole("combobox", { name: "Model" });
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Harness" })).toHaveTextContent("Codex"));
    await chooseChatSetting(canvas, "Model", "Discovered Codex model");
    await expect(model).toHaveTextContent("Discovered Codex model");
    await chooseChatSetting(canvas, "Harness", "Claude Code");
    // Another harness offers its own models and starts from its configured default.
    await expect(model).toHaveTextContent("Configured default");
    await userEvent.click(model);
    const models = within(await canvas.findByRole("listbox"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    await expect(models).toEqual(["Configured default", "Discovered Claude model"]);
    await userEvent.click(canvas.getByRole("option", { name: "Discovered Claude model" }));
    await expect(model).toHaveTextContent("Discovered Claude model");
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
      await waitFor(() => expect(canvas.getByRole("combobox", { name: "Harness" })).toHaveTextContent("Codex"));
      await chooseChatSetting(canvas, "Harness", "Claude Code");
      await chooseChatSetting(canvas, "Model", "Discovered Claude model");
      await userEvent.keyboard("{Escape}");
      await userEvent.type(await canvas.findByRole("textbox"), "Keep my page review");
      const nextURL = new URL(originalURL);
      nextURL.searchParams.set("page", "details");
      window.history.replaceState(window.history.state, "", nextURL);
      await userEvent.click(canvas.getByRole("button", { name: "Collapse Chat" }));
      await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
      await expect(canvas.getByRole("textbox")).toHaveValue("Keep my page review");
      await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
      await expect(canvas.getByRole("combobox", { name: "Harness" })).toHaveTextContent("Claude Code");
      await expect(canvas.getByRole("combobox", { name: "Model" })).toHaveTextContent("Discovered Claude model");
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
