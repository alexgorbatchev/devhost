import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { WorkflowSection } from "../WorkflowSection";

const meta: Meta<typeof WorkflowSection> = {
  component: WorkflowSection,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("WorkflowSection")).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "From dev command to real local stack." })).toBeInTheDocument();
    await expect(canvas.getByText("A small manifest buys a lot.")).toBeInTheDocument();
  },
};

export { Default as WorkflowSection };
