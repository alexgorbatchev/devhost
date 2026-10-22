import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { userEvent as nativeUserEvent } from "vitest/browser";
import { AgentChatBody } from "../AgentChatBody";
import { PageChatScene, ShadowPageChatScene, installPageChatCatalog } from "../../components/stories/helpers";
import { readDevtoolsStoryShadowCanvas } from "../../../../shared/components/stories/helpers";

const meta: Meta<typeof AgentChatBody> = {
  component: AgentChatBody,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/layouts/AgentChatBody",
  render: () => <PageChatScene />,
  beforeEach: installPageChatCatalog,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const CompactComposerSpacing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    const body = canvas.getByTestId("AgentChatBody");
    const composer = await within(body).findByRole("textbox");
    const bounds = body.getBoundingClientRect();
    const composerBounds = composer.getBoundingClientRect();
    await expect(composer).toBeVisible();
    expect(composerBounds.top).toBeGreaterThanOrEqual(bounds.top);
    expect(composerBounds.bottom).toBeLessThanOrEqual(bounds.bottom);
    expect(
      bounds.bottom - canvas.getByRole("button", { name: "Send Message" }).getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(16);
    await userEvent.type(composer, "Inspect this page");
    await expect(composer).toHaveValue("Inspect this page");
    await waitFor(() => expect(composer.getBoundingClientRect().top).toBeCloseTo(composerBounds.top, 0));
    await userEvent.clear(composer);
    await waitFor(() => expect(composer.getBoundingClientRect().top).toBeCloseTo(composerBounds.top, 0));
  },
};

export const InjectedComposerSpacing: Story = {
  render: () => <ShadowPageChatScene />,
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const composer = await canvas.findByRole("textbox", { name: "Message input" });
    const send = canvas.getByRole("button", { name: "Send Message" });
    const initialBounds = composer.getBoundingClientRect();
    expect(
      canvas.getByTestId("AgentChatBody").getBoundingClientRect().bottom - send.getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(16);
    await expect(send).toBeDisabled();
    await nativeUserEvent.click(composer);
    await nativeUserEvent.keyboard("Inspect this page");
    await expect(composer).toHaveValue("Inspect this page");
    await expect(send).toBeEnabled();
    await waitFor(() => expect(composer.getBoundingClientRect().top).toBeCloseTo(initialBounds.top, 0));
    await nativeUserEvent.keyboard("{Control>}a{/Control}{Backspace}");
    await expect(composer).toHaveValue("");
    await expect(send).toBeDisabled();
    await waitFor(() => expect(composer.getBoundingClientRect().top).toBeCloseTo(initialBounds.top, 0));
  },
};
