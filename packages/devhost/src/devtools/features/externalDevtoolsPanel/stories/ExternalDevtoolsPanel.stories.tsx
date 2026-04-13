import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { ExternalDevtoolsPanel } from "../ExternalDevtoolsPanel";

const meta: Meta<typeof ExternalDevtoolsPanel> = {
  title: "@alexgorbatchev/devhost/devtools/features/externalDevtoolsPanel/ExternalDevtoolsPanel",
  component: ExternalDevtoolsPanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <StoryContainer align={args.panelSide}>
          <ExternalDevtoolsPanel {...args} />
        </StoryContainer>
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultLeft: Story = {
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

export const DefaultRight: Story = {
  args: {
    launchers: [
      {
        id: "vue-devtools",
        isOpen: false,
        label: "Vue DevTools",
        title: "Open Vue DevTools",
      },
    ],
    onToggleLauncher: fn(),
    panelSide: "right",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ExternalDevtoolsPanel")).toBeInTheDocument();
    await expect(canvas.getByTestId("ExternalDevtoolsPanel--launcher-list")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Vue DevTools" }));
    await expect(args.onToggleLauncher).toHaveBeenCalledWith("vue-devtools");
  },
};

export const Empty: Story = {
  args: {
    launchers: [],
    onToggleLauncher: fn(),
    panelSide: "left",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("ExternalDevtoolsPanel")).not.toBeInTheDocument();
  },
};
