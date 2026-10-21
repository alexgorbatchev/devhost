import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ChatSettings } from "../ChatSettings";
import { PageChatScene, installPageChatCatalog } from "./helpers";
const meta: Meta<typeof ChatSettings> = {
  component: ChatSettings,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ChatSettings",
  render: () => <PageChatScene />,
  beforeEach: installPageChatCatalog,
};
export default meta;
type Story = StoryObj<typeof meta>;
const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    expect(canvas.queryByRole("combobox", { name: "Harness" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    const dialog = await canvas.findByRole("dialog", { name: "Chat Settings" });
    await waitFor(() => expect(dialog).toBeVisible());
    const model = within(dialog).getByRole("combobox", { name: "Model" });
    await within(dialog).findByRole("option", { name: "Discovered Codex model" });
    await userEvent.selectOptions(model, "codex-discovered");
    expect(model).toHaveValue("codex-discovered");
    expect(model.getBoundingClientRect().height).toBeGreaterThanOrEqual(28);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Chat Settings" })).toHaveFocus());
  },
};
export { Default as ChatSettings };
