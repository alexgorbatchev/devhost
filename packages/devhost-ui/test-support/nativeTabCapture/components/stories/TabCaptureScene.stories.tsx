import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { TabCaptureScene } from "../TabCaptureScene";
import { installPageChatCatalog } from "../../../../src/devtools/features/agentChat/components/stories/helpers";

const meta: Meta<typeof TabCaptureScene> = {
  component: TabCaptureScene,
  title: "@alexgorbatchev/devhost-ui/test-support/nativeTabCapture/components/TabCaptureScene",
  beforeEach: installPageChatCatalog,
};
export default meta;
type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("complementary", { name: "Agent chat" })).toBeVisible();
    await expect(canvas.getByRole("toolbar", { name: "devhost" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Collapse chat" }));
    await expect(canvas.queryByRole("complementary", { name: "Agent chat" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("toolbar", { name: "devhost" })).toBeVisible();
  },
};
export { Default as TabCaptureScene };
