import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ChatComposerActions } from "../ChatComposerActions";
import {
  ChatReloadScene,
  chooseChatSetting,
  deliverChatStatus,
  installChatReloadServer,
  openSavedChatConversation,
} from "./helpers";

const meta: Meta<typeof ChatComposerActions> = {
  component: ChatComposerActions,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ChatComposerActions",
  render: () => <ChatReloadScene />,
  beforeEach: () => installChatReloadServer(),
};
export default meta;
type Story = StoryObj<typeof meta>;

export const NewConversationStaysSelectedAfterReload: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSavedChatConversation(canvasElement);
    const closeConversation = canvas.getByRole("button", { name: "Close Conversation" });
    const newConversation = canvas.getByRole("button", { name: "New Conversation" });
    const shareTab = canvas.getByRole("button", { name: "Share Tab" });
    const sendMessage = canvas.getByRole("button", { name: "Send Message" });
    const actionsGroup = canvas.getByRole("group", { name: "Conversation actions" });
    expect(actionsGroup).toContainElement(closeConversation);
    expect(actionsGroup).toContainElement(shareTab);
    expect(closeConversation.getBoundingClientRect().right).toBeLessThanOrEqual(
      newConversation.getBoundingClientRect().left,
    );
    expect(newConversation.getBoundingClientRect().right).toBeLessThanOrEqual(shareTab.getBoundingClientRect().left);
    // Send Message sits outside the group but keeps the same spacing as the actions inside it.
    const actionGap = shareTab.getBoundingClientRect().left - newConversation.getBoundingClientRect().right;
    expect(sendMessage.getBoundingClientRect().left - shareTab.getBoundingClientRect().right).toBe(actionGap);
    expect(closeConversation.getBoundingClientRect().height).toBe(shareTab.getBoundingClientRect().height);
    expect(newConversation.getBoundingClientRect().height).toBe(shareTab.getBoundingClientRect().height);
    await expect(newConversation).toBeEnabled();
    await userEvent.click(newConversation);
    await canvas.findByText("Chat with your configured coding agent.");
    await userEvent.click(canvas.getByRole("button", { name: "Reload devtools" }));
    await canvas.findByText("codex · idle");
    await expect(canvas.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    const conversation = canvas.getByRole("combobox", { name: "Conversation" });
    expect(conversation).toHaveTextContent("codex · new-conversation-1");
    expect(within(canvas.getByRole("dialog")).queryByRole("button", { name: "New Conversation" })).toBeNull();
    // Starting a new conversation leaves the previous one available for explicit selection.
    await chooseChatSetting(canvas, "Conversation", "codex · saved-conversation");
    await userEvent.keyboard("{Escape}");
    await canvas.findByText("codex · idle");
    await waitFor(() => expect(canvas.queryByText("Chat with your configured coding agent.")).toBeNull());
  },
};

export const RunningConversationStillAllowsStartingAnother: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSavedChatConversation(canvasElement);
    deliverChatStatus("running");
    await canvas.findByText("codex · running");
    const newConversation = canvas.getByRole("button", { name: "New Conversation" });
    const stopButton = await canvas.findByRole("button", { name: "Stop Generating" });
    const sendButton = canvas.getByRole("button", { name: "Send Message" });
    expect(stopButton.getBoundingClientRect().height).toBe(sendButton.getBoundingClientRect().height);
    expect(stopButton.getBoundingClientRect().width).toBe(sendButton.getBoundingClientRect().width);
    await expect(newConversation).toBeEnabled();
    await userEvent.click(newConversation);
    await canvas.findByText("Chat with your configured coding agent.");
    await canvas.findByText("codex · idle");
  },
};

export const PendingRequestAllowsStartingAnotherConversation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSavedChatConversation(canvasElement);
    deliverChatStatus("requires_action");
    await canvas.findByText("codex · requires_action");
    await expect(canvas.getByRole("button", { name: "New Conversation" })).toBeEnabled();
    deliverChatStatus("idle");
    await canvas.findByText("codex · idle");
    await expect(canvas.getByRole("button", { name: "New Conversation" })).toBeEnabled();
  },
};
