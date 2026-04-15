import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/production";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within, waitFor } from "storybook/test";

import { ThemeProvider } from "../../../shared/ThemeProvider";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { ExternalDevtoolsPanel } from "../ExternalDevtoolsPanel";
import { useExternalDevtoolsLaunchers } from "../useExternalDevtoolsLaunchers";
import type { PanelSide } from "../../serviceStatusPanel";

const queryClient = new QueryClient();

const rootRoute = createRootRoute({
  component: () => null,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

const routeTree = rootRoute.addChildren([indexRoute]);
const router = createRouter({ history: createMemoryHistory(), routeTree });

interface IIntegratedPanelProps {
  panelSide: PanelSide;
}

function IntegratedPanel({ panelSide }: IIntegratedPanelProps) {
  const { launchers, toggleLauncher } = useExternalDevtoolsLaunchers(true);

  return (
    <>
      <QueryClientProvider client={queryClient}>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
      <RouterProvider router={router} />
      <TanStackRouterDevtools router={router} initialIsOpen={false} />

      <ThemeProvider colorScheme="dark">
        <StoryContainer align={panelSide}>
          <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={toggleLauncher} panelSide={panelSide} />
        </StoryContainer>
      </ThemeProvider>
    </>
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

interface ISharedPlayTestArgs {
  canvasElement: HTMLElement;
}

const sharedPlayTest = async ({ canvasElement }: ISharedPlayTestArgs): Promise<void> => {
  const canvas = within(canvasElement);

  // Wait for the hook to detect both devtools and render the launcher buttons
  await waitFor(
    () => {
      expect(canvas.queryByRole("button", { name: "Router" })).toBeInTheDocument();
      expect(canvas.queryByRole("button", { name: "Query" })).toBeInTheDocument();
    },
    { timeout: 5000 },
  );
};

export const DefaultLeft: Story = {
  args: {
    panelSide: "left",
    launchers: [],
    onToggleLauncher: () => {},
  },
  play: sharedPlayTest,
};

export const DefaultRight: Story = {
  args: {
    panelSide: "right",
    launchers: [],
    onToggleLauncher: () => {},
  },
  play: sharedPlayTest,
};
