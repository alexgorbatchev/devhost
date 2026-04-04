import type { Meta, StoryObj } from "@storybook/react";
import { RrwebDemoPanel } from "../RrwebDemoPanel";

const meta: Meta<typeof RrwebDemoPanel> = {
  component: RrwebDemoPanel,
};

export default meta;
type Story = StoryObj<typeof RrwebDemoPanel>;

const Default: Story = {
  args: {
    isDevelopmentMode: true,
    isRecording: false,
    onExportRecording: () => {},
    onStartRecording: () => {},
    onStopRecording: () => {},
    recording: null,
  },
  play: async () => {},
};

export { Default as RrwebDemoPanel };
