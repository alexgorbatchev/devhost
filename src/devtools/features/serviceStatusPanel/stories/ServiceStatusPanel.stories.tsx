import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { ServiceStatusPanel } from "../ServiceStatusPanel";

const meta: Meta<typeof ServiceStatusPanel> = {
  component: ServiceStatusPanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <ServiceStatusPanel {...args} />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    errorMessage: null,
    panelSide: "left",
    services: [
      { name: "api", status: true },
      { name: "worker", status: false },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ServiceStatusPanel")).toBeInTheDocument();
    await expect(canvas.getByText("worker")).toBeInTheDocument();
    await expect(canvas.queryByText("api")).not.toBeInTheDocument();
  },
};

export { Default as ServiceStatusPanel };
