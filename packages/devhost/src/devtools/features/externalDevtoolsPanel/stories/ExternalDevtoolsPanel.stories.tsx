import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { ExternalDevtoolsPanel } from "../ExternalDevtoolsPanel";
import type { PanelSide } from "../../serviceStatusPanel";
import type { IExternalDevtoolsLauncher } from "../types";

interface IIntegratedPanelProps {
  panelSide: PanelSide;
}

function IntegratedPanel({ panelSide }: IIntegratedPanelProps) {
  const launchers: IExternalDevtoolsLauncher[] = [
    {
      id: "router",
      isOpen: false,
      label: "Router",
      title: "Router",
    },
    {
      id: "query",
      isOpen: false,
      label: "Query",
      title: "Query",
    },
  ];

  return (
    <ThemeProvider colorScheme="dark">
      <StoryContainer align={panelSide}>
        <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={() => {}} panelSide={panelSide} />
      </StoryContainer>
    </ThemeProvider>
  );
}

const meta: Meta<typeof ExternalDevtoolsPanel> = {
  title: "@alexgorbatchev/devhost/devtools/features/externalDevtoolsPanel/ExternalDevtoolsPanel",
  component: ExternalDevtoolsPanel,
  render: (args) => {
    return <IntegratedPanel panelSide={args.panelSide} />;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultLeft: Story = {
  args: {
    panelSide: "left",
    launchers: [],
    onToggleLauncher: () => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    const routerButton = await canvas.findByRole("button", { name: "Router" });
    const queryButton = await canvas.findByRole("button", { name: "Query" });

    await expect(routerButton).toBeInTheDocument();
    await expect(queryButton).toBeInTheDocument();

    await userEvent.click(routerButton);
    await userEvent.click(queryButton);
  },
};

export const DefaultRight: Story = {
  args: {
    panelSide: "right",
    launchers: [],
    onToggleLauncher: () => {},
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    const routerButton = await canvas.findByRole("button", { name: "Router" });
    const queryButton = await canvas.findByRole("button", { name: "Query" });

    await expect(routerButton).toBeInTheDocument();
    await expect(queryButton).toBeInTheDocument();

    await userEvent.click(routerButton);
    await userEvent.click(queryButton);
  },
};
