import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { WorkflowStepCard } from "../WorkflowStepCard";

const meta: Meta<typeof WorkflowStepCard> = {
  component: WorkflowStepCard,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    description: "Start the managed edge once so routing and TLS stay under one owner.",
    stepLabel: "01",
    title: "Boot the managed edge",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Boot the managed edge")).toBeInTheDocument();
    await expect(canvas.getByText("01")).toBeInTheDocument();
  },
};

export { Default as WorkflowStepCard };
