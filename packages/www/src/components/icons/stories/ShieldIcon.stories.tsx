import type { Meta, StoryObj } from "@storybook/react";

import { ShieldIcon } from "../ShieldIcon";

type Story = StoryObj<typeof ShieldIcon>;

const meta: Meta<typeof ShieldIcon> = {
  component: ShieldIcon,
  title: "Icons/ShieldIcon",
};

export default meta;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as ShieldIcon };
