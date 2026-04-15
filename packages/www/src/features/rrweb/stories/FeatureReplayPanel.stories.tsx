import type { Meta, StoryObj } from "@storybook/react-vite";
import { type JSX } from "react";
import { expect, within } from "storybook/test";

import { FeatureReplayPanel } from "../FeatureReplayPanel";
import { useStoryRecording } from "./storyRecording";

const meta: Meta<typeof FeatureReplayPanel> = {
  title: "devhost-test-app/features/rrweb/FeatureReplayPanel",
  component: FeatureReplayPanel,
};

export default meta;

type Story = StoryObj<typeof meta>;

function StoryRecordingFeatureReplayPanel(props: { emptyMessage: string; isFullscreen?: boolean }): JSX.Element {
  const recording = useStoryRecording();

  return (
    <FeatureReplayPanel emptyMessage={props.emptyMessage} isFullscreen={props.isFullscreen} recording={recording} />
  );
}

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

export { Default as FeatureReplayPanel };
