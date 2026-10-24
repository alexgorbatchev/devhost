import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";
import { StatusFrame } from "../StatusFrame";
import "../../statusPages.css";

const meta: Meta<typeof StatusFrame> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/StatusFrame",
  component: StatusFrame,
  args: { status: 503, title: "Starting web", message: "Waiting for a healthy response", context: "shop" },
};
export default meta;
type Story = StoryObj<typeof meta>;
const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent("Starting web");
    await expect(canvas.getByRole("status")).toHaveTextContent("Waiting for a healthy response");
  },
};

export { Default as StatusFrame };
