import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Surface } from "../Surface";

const meta: Meta<typeof Surface> = {
  title: "devhost-test-app/components/ui/Surface",
  component: Surface,
  render: () => {
    return <Surface>Surface body</Surface>;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Surface body")).toBeInTheDocument();
  },
};

export { Default as Surface };
