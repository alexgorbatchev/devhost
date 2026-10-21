import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { AgentChatBody } from "../AgentChatBody";
import { PageChatScene, installPageChatCatalog } from "../../components/stories/helpers";

const meta: Meta<typeof AgentChatBody> = {
  component: AgentChatBody,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/layouts/AgentChatBody",
  render: () => <PageChatScene />,
  beforeEach: installPageChatCatalog,
};
export default meta;
type Story = StoryObj<typeof meta>;

const Default: Story = {
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
    await userEvent.type(composer, "Inspect this page");
    await expect(composer).toHaveValue("Inspect this page");
  },
};
export { Default as AgentChatBody };
