import type { Meta, StoryObj } from "@storybook/react";

import { Main } from "../main";

const meta: Meta<typeof Main> = {
  component: Main,
};

export default meta;

type Story = StoryObj<typeof Main>;

const Default: Story = {
  play: async () => {},
};

export { Default as Main };
