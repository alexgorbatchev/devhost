import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { ShieldIcon } from "../ShieldIcon";

type Story = StoryObj<typeof ShieldIcon>;

const meta: Meta<typeof ShieldIcon> = {
  component: ShieldIcon,
  title: "devhost-test-app/components/icons/ShieldIcon",
};

export default meta;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ShieldIcon")).toBeInTheDocument();
  },
};

export { Default as ShieldIcon };
