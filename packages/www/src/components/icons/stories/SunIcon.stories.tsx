import type { Meta, StoryObj } from "@storybook/react";

import { SunIcon } from "../SunIcon";

type Story = StoryObj<typeof SunIcon>;

const meta: Meta<typeof SunIcon> = {
  component: SunIcon,
  title: "components/icons/SunIcon",
};

export default meta;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as SunIcon };
