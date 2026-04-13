import type { Meta, StoryObj } from "@storybook/react";

import { MoonIcon } from "../MoonIcon";

type Story = StoryObj<typeof MoonIcon>;

const meta: Meta<typeof MoonIcon> = {
  component: MoonIcon,
  title: "devhost-test-app/components/icons/MoonIcon",
};

export default meta;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as MoonIcon };
