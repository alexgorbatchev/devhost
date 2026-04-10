import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { ExternalDevtoolsPanel } from "../ExternalDevtoolsPanel";

const meta: Meta<typeof ExternalDevtoolsPanel> = {
  component: ExternalDevtoolsPanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <ExternalDevtoolsPanel {...args} />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    launchers: [
      {
        id: "react-devtools",
        isOpen: false,
        label: "React DevTools",
        title: "Open React DevTools",
      },
      {
        id: "storybook",
        isOpen: true,
        label: "Storybook",
        title: "Open Storybook toolbar",
      },
    ],
    onToggleLauncher: fn(),
    panelSide: "left",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ExternalDevtoolsPanel")).toBeInTheDocument();
    await expect(canvas.getByTestId("ExternalDevtoolsPanel--launcher-list")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "React DevTools" }));
    await expect(args.onToggleLauncher).toHaveBeenCalledWith("react-devtools");
  },
};

export { Default as ExternalDevtoolsPanel };
