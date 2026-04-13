import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { InlineCallout } from "../InlineCallout";

const meta: Meta<typeof InlineCallout> = {
  title: "devhost-test-app/components/ui/InlineCallout",
  component: InlineCallout,
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "#1",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("InlineCallout")).toBeInTheDocument();
    await expect(canvas.getByText("#1")).toBeInTheDocument();
  },
};

export const WithBorder: Story = {
  args: {
    children: "#2",
    hasBorder: true,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("InlineCallout")).toBeInTheDocument();
    await expect(canvas.getByText("#2")).toBeInTheDocument();
  },
};
