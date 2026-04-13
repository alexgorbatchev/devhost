import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { FeatureReplayPanel } from "../FeatureReplayPanel";

const meta: Meta<typeof FeatureReplayPanel> = {
  title: "devhost-test-app/features/rrweb/FeatureReplayPanel",
  component: FeatureReplayPanel,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    emptyMessage: "Preview unavailable.",
    recording: null,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("FeatureReplayPanel")).toBeInTheDocument();
    await expect(canvas.getByText("Preview unavailable.")).toBeInTheDocument();
  },
};

export { Default as FeatureReplayPanel };
