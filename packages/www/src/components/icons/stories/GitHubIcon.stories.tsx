import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { GitHubIcon } from "../GitHubIcon";

type Story = StoryObj<typeof GitHubIcon>;

const meta: Meta<typeof GitHubIcon> = {
  component: GitHubIcon,
  title: "devhost-test-app/components/icons/GitHubIcon",
};

export default meta;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("GitHubIcon")).toBeInTheDocument();
  },
};

export { Default as GitHubIcon };
