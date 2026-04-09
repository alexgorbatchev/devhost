import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { FeatureHighlightPanel } from "../FeatureHighlightPanel";
import { featureHighlights } from "../featureHighlights";

const meta: Meta<typeof FeatureHighlightPanel> = {
  component: FeatureHighlightPanel,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: featureHighlights[0],
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("FeatureHighlightPanel")).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { level: 3, name: featureHighlights[0]?.title })).toBeInTheDocument();
  },
};

export { Default as FeatureHighlightPanel };
