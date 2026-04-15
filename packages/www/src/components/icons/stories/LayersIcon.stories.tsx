import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { LayersIcon } from "../LayersIcon";

type Story = StoryObj<typeof LayersIcon>;

const meta: Meta<typeof LayersIcon> = {
  component: LayersIcon,
  title: "devhost-test-app/components/icons/LayersIcon",
};

export default meta;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("LayersIcon")).toBeInTheDocument();
  },
};

export { Default as LayersIcon };
