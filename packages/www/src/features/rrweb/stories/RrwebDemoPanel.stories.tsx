import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { RrwebDemoPanel } from "../RrwebDemoPanel";

const meta: Meta<typeof RrwebDemoPanel> = {
  title: "features/rrweb/RrwebDemoPanel",
  component: RrwebDemoPanel,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    isDevelopmentMode: true,
    isRecording: false,
    onExportRecording: (): void => {},
    onStartRecording: (): void => {},
    onStopRecording: (): void => {},
    recording: null,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("RrwebDemoPanel")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Start recording · Alt+Shift+A" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Export JSON" })).not.toBeInTheDocument();
  },
};

export { Default as RrwebDemoPanel };
