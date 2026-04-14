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
        id: "tanstack-router",
        isOpen: false,
        label: "Router",
        title: "Toggle TanStack Router devtools",
      },
      {
        id: "tanstack-query",
        isOpen: true,
        label: "Query",
        title: "Toggle TanStack Query devtools",
      },
    ],
    onToggleLauncher: fn(),
    panelSide: "left",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ExternalDevtoolsPanel")).toBeInTheDocument();
    await expect(canvas.getByTestId("ExternalDevtoolsPanel--launcher-list")).toBeInTheDocument();

    const routerButton = canvas.getByRole("button", { name: "Router" });
    const queryButton = canvas.getByRole("button", { name: "Query" });

    // Simulate DOM elements being present for detectors if needed in a real integration test
    // For unit/storybook tests of this component we just verify the event firing.

    await userEvent.click(routerButton);
    await expect(args.onToggleLauncher).toHaveBeenCalledWith("tanstack-router");

    await userEvent.click(queryButton);
    await expect(args.onToggleLauncher).toHaveBeenCalledWith("tanstack-query");
  },
};

export const DefaultRight: Story = {
  args: {
    launchers: [
      {
        id: "tanstack-router",
        isOpen: false,
        label: "Router",
        title: "Toggle TanStack Router devtools",
      },
      {
        id: "tanstack-query",
        isOpen: true,
        label: "Query",
        title: "Toggle TanStack Query devtools",
      },
    ],
    onToggleLauncher: fn(),
    panelSide: "right",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ExternalDevtoolsPanel")).toBeInTheDocument();
    await expect(canvas.getByTestId("ExternalDevtoolsPanel--launcher-list")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Router" }));
    await expect(args.onToggleLauncher).toHaveBeenCalledWith("tanstack-router");

    await userEvent.click(canvas.getByRole("button", { name: "Query" }));
    await expect(args.onToggleLauncher).toHaveBeenCalledWith("tanstack-query");
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
