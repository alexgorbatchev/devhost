import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";
import { ChatDeliveryStatus } from "../ChatDeliveryStatus";

const meta: Meta<typeof ChatDeliveryStatus> = {
  component: ChatDeliveryStatus,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ChatDeliveryStatus",
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Queued: Story = {
  args: { state: "queued" },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole("status")).toHaveTextContent("Queued.");
  },
};

export const Unconfirmed: Story = {
  args: { state: "unconfirmed" },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole("status")).toHaveTextContent("Check the conversation before retrying.");
  },
};

export const Cancelled: Story = {
  args: { state: "cancelled" },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole("status")).toHaveTextContent("Stopped before the agent read this message.");
  },
};

export const RunningShowsNothing: Story = {
  args: { state: "started" },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole("status")).toBeNull();
  },
};
