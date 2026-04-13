import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Main } from "../Main";

const meta: Meta<typeof Main> = {
  title: "app/Main",
  component: Main,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("App")).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", {
        name: "replace localhost:3000 with https://app.localhost and then some more",
      }),
    ).toBeInTheDocument();
  },
};

export { Default as Main };
