import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { ThemeProvider } from "../ThemeProvider";

const meta: Meta<typeof ThemeProvider> = {
  title: "devtools/shared/ThemeProvider",
  component: ThemeProvider,
  render: (args) => {
    return <ThemeProvider {...args} />;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    children: <div>Theme content</div>,
    colorScheme: "dark",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Theme content")).toBeInTheDocument();
  },
};

export { Default as ThemeProvider };
