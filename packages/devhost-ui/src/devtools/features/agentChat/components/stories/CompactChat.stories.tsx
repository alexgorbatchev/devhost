import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { userEvent as nativeUserEvent } from "vitest/browser";
import { z } from "zod";
import { CompactChat } from "../CompactChat";
import { readContrastRatio } from "../../../../../../../../test-support/readContrastRatio";
import {
  ChatReloadScene,
  openSavedChatConversation,
  installChatReloadServer,
  readSentChatCommands,
  acknowledgeChatSend,
  deliverChatStatus,
  deliverChatReply,
  copyChatImage,
} from "./helpers";
const meta: Meta<typeof CompactChat> = {
  component: CompactChat,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/CompactChat",
  render: () => <ChatReloadScene />,
  beforeEach: () => installChatReloadServer(),
};
export default meta;
type Story = StoryObj<typeof meta>;

export const CompactReplyCycle: Story = {
  render: () => <ChatReloadScene />,
  beforeEach: () => installChatReloadServer(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSavedChatConversation(canvasElement);
    const panel = canvas.getByRole("complementary", { name: "Agent chat" });
    const expandedHeight = panel.getBoundingClientRect().height;
    await userEvent.click(canvas.getByRole("button", { name: "Compact Chat" }));
    expect(panel.getBoundingClientRect().height).toBeLessThan(expandedHeight / 2);
    const latest = within(canvas.getByRole("region", { name: "Latest agent response" }));
    expect(latest.getByText(/^Reply 30:/)).toBeVisible();
    expect(readContrastRatio(latest.getByText(/^Reply 30:/))).toBeGreaterThanOrEqual(4.5);
    expect(canvas.queryByText(/^Reply 1:/)).toBeNull();
    const composer = canvas.getByRole("textbox", { name: "Message input" });
    for (const [index, text] of ["Fix the heading", "Now fix the spacing"].entries()) {
      await userEvent.type(composer, text);
      await userEvent.keyboard("{Enter}");
      await latest.findByText("Working…");
      expect(readContrastRatio(latest.getByText("Working…"))).toBeGreaterThanOrEqual(4.5);
      expect(latest.queryByText(/^Reply 30:/)).toBeNull();
      expect(latest.queryByText("Live reply 31.")).toBeNull();
      await waitFor(() => expect(readSentChatCommands()).toHaveLength(index + 1));
      const command = z.object({ commandId: z.string(), text: z.string() }).parse(readSentChatCommands()[index]);
      expect(command.text).toBe(text);
      acknowledgeChatSend(command.commandId);
      await waitFor(() => expect(canvas.getByRole("button", { name: "Close Conversation" })).toBeEnabled());
      expect(canvas.getByRole("button", { name: "New Conversation" })).toBeDisabled();
      expect(latest.getByText("Working…")).toBeVisible();
      deliverChatStatus("running");
      await latest.findByText("Working…");
      deliverChatReply(31 + index);
      // Completed individual messages do not replace the working state before the whole turn ends.
      expect(latest.queryByText(`Live reply ${31 + index}.`)).toBeNull();
      deliverChatStatus("idle");
      await latest.findByText(`Live reply ${31 + index}.`);
    }
    await userEvent.type(composer, "Keep this draft");
    await userEvent.click(canvas.getByRole("button", { name: "Expand Chat" }));
    await canvas.findByText(/^Reply 1:/);
    await canvas.findByText("Live reply 31.");
    expect(canvas.getByRole("textbox")).toHaveValue("Keep this draft");
    await userEvent.click(canvas.getByRole("button", { name: "Compact Chat" }));
    expect(canvas.getByRole("textbox")).toHaveValue("Keep this draft");
    expect(canvas.queryByText("Live reply 31.")).toBeNull();
  },
};

export const LightCompactReplyCycle: Story = {
  ...CompactReplyCycle,
  globals: { devhostTheme: "light" },
  play: CompactReplyCycle.play,
};

export const WaitingForNativeResponse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSavedChatConversation(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Compact Chat" }));
    const latest = within(canvas.getByRole("region", { name: "Latest agent response" }));
    deliverChatStatus("requires_action");
    await latest.findByText("Waiting for your response…");
    expect(latest.queryByText(/^Reply 30:/)).toBeNull();
    expect(canvas.getByRole("button", { name: "New Conversation" })).toBeDisabled();
    deliverChatStatus("idle");
    await latest.findByText(/^Reply 30:/);
    expect(canvas.getByRole("button", { name: "New Conversation" })).toBeEnabled();
  },
};

export const FailedSendRestoresDraftAndPreviousReply: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSavedChatConversation(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Compact Chat" }));
    const latest = within(canvas.getByRole("region", { name: "Latest agent response" }));
    const composer = canvas.getByRole("textbox", { name: "Message input" });
    await userEvent.type(composer, "Retry this message");
    await userEvent.keyboard("{Enter}");
    await latest.findByText("Working…");
    await waitFor(() => expect(readSentChatCommands()).toHaveLength(1));
    const command = z.object({ commandId: z.string() }).parse(readSentChatCommands()[0]);
    acknowledgeChatSend(command.commandId, "Message delivery rejected");
    await canvas.findByText("Message delivery rejected");
    await waitFor(() => expect(composer).toHaveValue("Retry this message"));
    expect(latest.getByText(/^Reply 30:/)).toBeVisible();
    expect(latest.queryByText("Working…")).toBeNull();
    expect(canvas.getByRole("button", { name: "New Conversation" })).toBeEnabled();
  },
};

export const CompactPasteImage: Story = {
  render: () => <ChatReloadScene />,
  beforeEach: () => installChatReloadServer(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSavedChatConversation(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Compact Chat" }));
    await copyChatImage();
    await nativeUserEvent.click(canvas.getByRole("textbox", { name: "Message input" }));
    await nativeUserEvent.keyboard("{ControlOrMeta>}v{/ControlOrMeta}");
    await canvas.findByRole("button", { name: /^Remove .*\.png$/ });
    await userEvent.click(canvas.getByRole("button", { name: "Expand Chat" }));
    await canvas.findByRole("button", { name: /^Remove .*\.png$/ });
    await userEvent.click(canvas.getByRole("button", { name: "Compact Chat" }));
    await canvas.findByRole("button", { name: /^Remove .*\.png$/ });
    await userEvent.click(canvas.getByRole("button", { name: "Send Message" }));
    await waitFor(() => expect(readSentChatCommands()).toHaveLength(1));
    const command = z
      .object({ commandId: z.string(), images: z.array(z.object({ dataURL: z.string() })) })
      .parse(readSentChatCommands()[0]);
    expect(command.images).toEqual([{ dataURL: expect.stringMatching(/^data:image\/png;base64,/) }]);
    acknowledgeChatSend(command.commandId);
    await waitFor(() => expect(canvas.queryByRole("button", { name: /^Remove .*\.png$/ })).toBeNull());
  },
};
