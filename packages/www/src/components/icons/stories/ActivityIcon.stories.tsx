import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { ActivityIcon } from "../ActivityIcon";

type Story = StoryObj<typeof ActivityIcon>;

const meta: Meta<typeof ActivityIcon> = {
  component: ActivityIcon,
  title: "devhost-test-app/components/icons/ActivityIcon",
};

export default meta;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ActivityIcon")).toBeInTheDocument();
  },
};

export { Default as ActivityIcon };
