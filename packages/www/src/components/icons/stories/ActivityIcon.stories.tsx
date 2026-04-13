import type { Meta, StoryObj } from "@storybook/react";

import { ActivityIcon } from "../ActivityIcon";

type Story = StoryObj<typeof ActivityIcon>;

const meta: Meta<typeof ActivityIcon> = {
  component: ActivityIcon,
  title: "devhost-test-app/components/icons/ActivityIcon",
};

export default meta;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as ActivityIcon };
