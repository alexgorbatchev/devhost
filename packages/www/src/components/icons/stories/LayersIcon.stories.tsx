import type { Meta, StoryObj } from "@storybook/react";

import { LayersIcon } from "../LayersIcon";

type Story = StoryObj<typeof LayersIcon>;

const meta: Meta<typeof LayersIcon> = {
  component: LayersIcon,
  title: "components/icons/LayersIcon",
};

export default meta;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as LayersIcon };
