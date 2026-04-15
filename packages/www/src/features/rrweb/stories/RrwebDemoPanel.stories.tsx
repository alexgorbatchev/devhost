import type { Meta, StoryObj } from "@storybook/react-vite";
import { type JSX } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { RrwebDemoPanel as RrwebDemoPanelComponent, type IRrwebDemoPanelProps } from "../RrwebDemoPanel";
import { useStoryRecording } from "./storyRecording";

const meta: Meta<typeof RrwebDemoPanelComponent> = {
  title: "devhost-test-app/features/rrweb/RrwebDemoPanel",
  component: RrwebDemoPanelComponent,
};

export default meta;

type Story = StoryObj<typeof meta>;

type StoryRecordingRrwebDemoPanelProps = Omit<IRrwebDemoPanelProps, "recording">;

function StoryRecordingRrwebDemoPanel(props: StoryRecordingRrwebDemoPanelProps): JSX.Element {
  const recording = useStoryRecording();

  return <RrwebDemoPanelComponent {...props} recording={recording} />;
}

export const RrwebDemoPanel: Story = {
  args: {
    isDevelopmentMode: true,
    isRecording: false,
    onExportRecording: fn(),
    onStartRecording: fn(),
    onStopRecording: fn(),
    recording: null,
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const startButton = canvas.getByRole("button", { name: "Start recording · Alt+Shift+A" });

    await expect(canvas.getByTestId("RrwebDemoPanel")).toBeInTheDocument();
    await expect(startButton).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Export JSON" })).not.toBeInTheDocument();

    await userEvent.click(startButton);
    await expect(args.onStartRecording).toHaveBeenCalledTimes(1);
  },
};

export const RecordingInProgress: Story = {
  args: {
    isDevelopmentMode: true,
    isRecording: true,
    onExportRecording: fn(),
    onStartRecording: fn(),
    onStopRecording: fn(),
    recording: null,
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole("button", { name: "Start recording · Alt+Shift+A" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Export JSON" })).not.toBeInTheDocument();

    await userEvent.keyboard("{Alt>}{Shift>}a{/Shift}{/Alt}");
    await expect(args.onStopRecording).toHaveBeenCalledTimes(1);
  },
};

export const PreviewReady: Story = {
  args: {
    isDevelopmentMode: true,
    isRecording: false,
    onExportRecording: fn(),
    onStartRecording: fn(),
    onStopRecording: fn(),
  },
  render: (args) => {
    return <StoryRecordingRrwebDemoPanel {...args} />;
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const exportButton = await canvas.findByRole("button", { name: "Export JSON" });

    await expect(canvas.getByTestId("RrwebDemoPanel--preview")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Start recording · Alt+Shift+A" })).not.toBeInTheDocument();

    await userEvent.click(exportButton);
    await expect(args.onExportRecording).toHaveBeenCalledTimes(1);
  },
};

export const ProductionMode: Story = {
  args: {
    isDevelopmentMode: false,
    isRecording: false,
    onExportRecording: fn(),
    onStartRecording: fn(),
    onStopRecording: fn(),
  },
  render: (args) => {
    return <StoryRecordingRrwebDemoPanel {...args} />;
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("RrwebDemoPanel")).toBeInTheDocument();
    await expect(canvas.queryByTestId("RrwebDemoPanel--preview")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("RrwebDemoPanel--controls")).not.toBeInTheDocument();
  },
};
