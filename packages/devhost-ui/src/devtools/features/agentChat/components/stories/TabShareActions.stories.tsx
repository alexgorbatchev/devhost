import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { TabShareContext } from "../../TabShareContext";
import { TabShareActions } from "../TabShareActions";
import { useState } from "react";
const share = fn(async () => {});
const meta: Meta<typeof TabShareActions> = {
  component: TabShareActions,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/TabShareActions",
  render: () => (
    <TabShareContext
      value={{
        stream: undefined,
        isRequesting: false,
        error: null,
        share,
        stop: fn(),
        shouldIncludeSnapshot: true,
        setShouldIncludeSnapshot: fn(),
      }}
    >
      <TabShareActions />
    </TabShareContext>
  ),
};
export default meta;
type Story = StoryObj<typeof meta>;
export const ShareTab: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Share Tab" }));
    expect(share).toHaveBeenCalledOnce();
  },
};

export const SkipSnapshotsWhileSharing: Story = {
  render: function SharingScene() {
    const [stream, setStream] = useState<MediaStream | undefined>(() => new MediaStream());
    const [shouldIncludeSnapshot, setShouldIncludeSnapshot] = useState(true);
    return (
      <TabShareContext
        value={{
          stream,
          shouldIncludeSnapshot,
          setShouldIncludeSnapshot,
          isRequesting: false,
          error: null,
          share,
          stop: () => setStream(undefined),
        }}
      >
        <TabShareActions />
      </TabShareContext>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Include Tab Snapshot" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(canvas.getByRole("button", { name: "Stop Sharing" })).toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Stop Sharing" }));
    expect(canvas.queryByRole("button", { name: "Include Tab Snapshot" })).toBeNull();
    expect(canvas.getByRole("button", { name: "Share Tab" })).toBeVisible();
  },
};
