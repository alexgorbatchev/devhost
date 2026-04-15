import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { SunIcon } from "../SunIcon";

type Story = StoryObj<typeof SunIcon>;

const meta: Meta<typeof SunIcon> = {
  component: SunIcon,
  title: "devhost-test-app/components/icons/SunIcon",
};

export default meta;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("SunIcon")).toBeInTheDocument();
  },
};

export { Default as SunIcon };
