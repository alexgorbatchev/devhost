import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { DevtoolsIcon } from "../DevtoolsIcon";

type Story = StoryObj<typeof DevtoolsIcon>;

const meta: Meta<typeof DevtoolsIcon> = {
  component: DevtoolsIcon,
  title: "devhost-test-app/components/icons/DevtoolsIcon",
};

export default meta;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("DevtoolsIcon")).toBeInTheDocument();
  },
};

export { Default as DevtoolsIcon };
