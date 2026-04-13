import type { Meta, StoryObj } from "@storybook/react";

import { GitHubIcon } from "../GitHubIcon";

type Story = StoryObj<typeof GitHubIcon>;

const meta: Meta<typeof GitHubIcon> = {
  component: GitHubIcon,
  title: "devhost-test-app/components/icons/GitHubIcon",
};

export default meta;

const Default: Story = {
  play: async (): Promise<void> => {},
};

export { Default as GitHubIcon };
