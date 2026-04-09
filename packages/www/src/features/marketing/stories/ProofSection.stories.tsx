import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ProofSection } from "../ProofSection";

const meta: Meta<typeof ProofSection> = {
  component: ProofSection,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ProofSection")).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Serious local infrastructure, with honest boundaries." })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { level: 3, name: "Requirements" })).toBeInTheDocument();
  },
};

export { Default as ProofSection };
