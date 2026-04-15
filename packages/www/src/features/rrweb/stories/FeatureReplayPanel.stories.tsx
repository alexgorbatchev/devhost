import type { Meta, StoryObj } from "@storybook/react-vite";
import { type JSX } from "react";
import { expect, within } from "storybook/test";

import {
  FeatureReplayPanel as FeatureReplayPanelComponent,
  type IFeatureReplayPanelProps,
} from "../FeatureReplayPanel";
import { useStoryRecording } from "./storyRecording";

const meta: Meta<typeof FeatureReplayPanelComponent> = {
  title: "devhost-test-app/features/rrweb/FeatureReplayPanel",
  component: FeatureReplayPanelComponent,
};

export default meta;

type Story = StoryObj<typeof meta>;

type StoryRecordingFeatureReplayPanelProps = Omit<IFeatureReplayPanelProps, "recording">;

function StoryRecordingFeatureReplayPanel(props: StoryRecordingFeatureReplayPanelProps): JSX.Element {
  const recording = useStoryRecording();

  return (
    <FeatureReplayPanelComponent
      emptyMessage={props.emptyMessage}
      isFullscreen={props.isFullscreen}
      recording={recording}
    />
  );
}

export const FeatureReplayPanel: Story = {
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

export const LoadedReplay: Story = {
  args: {
    emptyMessage: "Loading recording...",
  },
  render: (args) => {
    return <StoryRecordingFeatureReplayPanel emptyMessage={args.emptyMessage} />;
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("FeatureReplayPanel--player-root")).toBeInTheDocument();
    await expect(canvas.getByTestId("FeatureReplayPanel--controls")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Play replay" })).toBeInTheDocument();
    await expect(canvas.getByRole("slider", { name: "Replay timeline" })).toBeInTheDocument();
  },
};

export const FullscreenReplay: Story = {
  args: {
    emptyMessage: "Loading recording...",
    isFullscreen: true,
  },
  render: (args) => {
    return <StoryRecordingFeatureReplayPanel emptyMessage={args.emptyMessage} isFullscreen={args.isFullscreen} />;
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("FeatureReplayPanel--player-root")).toBeInTheDocument();
    await expect(canvas.getByTestId("FeatureReplayPanel")).toHaveClass("h-full");
    await expect(canvas.getByTestId("FeatureReplayPanel--controls")).toBeInTheDocument();
  },
};
