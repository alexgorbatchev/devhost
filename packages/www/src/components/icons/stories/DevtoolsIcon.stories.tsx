import type { Meta, StoryObj } from "@storybook/react";

import { DevtoolsIcon } from "../DevtoolsIcon";

type Story = StoryObj<typeof DevtoolsIcon>;

const meta: Meta<typeof DevtoolsIcon> = {
  component: DevtoolsIcon,
  title: "devhost-test-app/components/icons/DevtoolsIcon",
};

export default meta;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as DevtoolsIcon };
