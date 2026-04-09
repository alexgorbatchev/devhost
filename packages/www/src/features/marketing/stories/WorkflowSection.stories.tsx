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
    await expect(
      canvas.getByRole("heading", { name: "Give the stack a disciplined path from boot to inspection." }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("The demo app now reads like product evidence.")).toBeInTheDocument();
  },
};

export { Default as WorkflowSection };
