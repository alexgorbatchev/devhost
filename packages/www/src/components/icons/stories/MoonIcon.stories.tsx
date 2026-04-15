import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { MoonIcon } from "../MoonIcon";

type Story = StoryObj<typeof MoonIcon>;

const meta: Meta<typeof MoonIcon> = {
  component: MoonIcon,
  title: "devhost-test-app/components/icons/MoonIcon",
};

export default meta;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("MoonIcon")).toBeInTheDocument();
  },
};

export { Default as MoonIcon };
