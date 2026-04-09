import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { FeatureSection } from "../FeatureSection";

const meta: Meta<typeof FeatureSection> = {
  component: FeatureSection,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("FeatureSection")).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: "Annotation handoff" })).toBeInTheDocument();
    await expect(canvas.getByRole("tab", { name: "Routing + health" })).toBeInTheDocument();
  },
};

export { Default as FeatureSection };
