import type { Meta, StoryObj } from "@storybook/react";

import { Entry } from "../entry";

const meta: Meta<typeof Entry> = {
  component: Entry,
};

export default meta;

type Story = StoryObj<typeof Entry>;

const Default: Story = {
  play: async () => {},
};

export { Default as Entry };
