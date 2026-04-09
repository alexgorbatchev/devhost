import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { FeatureReplay } from "../FeatureReplay";

const missingRecordingUrl: string = "/recordings/marketing/missing.json";

const meta: Meta<typeof FeatureReplay> = {
  component: FeatureReplay,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    demoRecordingUrl: missingRecordingUrl,
    featureId: "agent-handoff",
    kicker: "AI annotations",
    title: "Turn a page annotation into a live coding session",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("FeatureReplay")).toBeInTheDocument();
    await expect(
      canvas.findByText(`Replay missing. Add the recording JSON at ${missingRecordingUrl}.`),
    ).resolves.toBeInTheDocument();
  },
};

export { Default as FeatureReplay };
