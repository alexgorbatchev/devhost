import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { LogMinimap } from "../LogMinimap";

const meta: Meta<typeof LogMinimap> = {
  component: LogMinimap,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <LogMinimap {...args} />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    entries: [{ id: 1, line: "ready", serviceName: "api", stream: "stdout" }],
    isHovered: false,
    minimapPosition: "right",
    onHoveredChange: (): void => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("LogMinimap")).toBeInTheDocument();
    await expect(canvas.getByTestId("LogMinimap--canvas")).toBeInTheDocument();
  },
};

export { Default as LogMinimap };
