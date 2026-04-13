import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { App } from "../App";

const meta: Meta<typeof App> = {
  title: "devtools/App",
  component: App,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("AppContent")).toBeInTheDocument();
    await expect(await canvas.findByTestId("ServiceStatusPanel")).toBeInTheDocument();
    await expect(await canvas.findByTestId("LogMinimap")).toBeInTheDocument();
  },
};

export { Default as App };
