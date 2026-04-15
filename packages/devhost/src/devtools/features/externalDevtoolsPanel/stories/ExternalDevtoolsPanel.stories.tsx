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

async function waitForToolbarsToBeHidden(selectors: string[]): Promise<void> {
  await waitFor(() => {
    expect(
      selectors.every((selector) => {
        const originalToolbar = document.querySelector(selector);

        return originalToolbar === null || window.getComputedStyle(originalToolbar).display === "none";
      }),
    ).toBe(true);
  });
}

async function waitForRouterPanelToBeVisible(): Promise<void> {
  await waitFor(() => {
    const routerPanel = document.querySelector(".TanStackRouterDevtoolsPanel");

    expect(routerPanel).not.toBeNull();

    if (routerPanel !== null) {
      const style = window.getComputedStyle(routerPanel);

      expect(style.display).not.toBe("none");
      expect(style.visibility).not.toBe("hidden");
    }
  });
}

async function waitForQueryPanelToBeOpen(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector(".tsqd-main-panel")).not.toBeNull();
  });
}

async function waitForQueryPanelToBeClosed(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector(".tsqd-main-panel")).toBeNull();
  });
}

async function ensureRouterPanelIsOpen(readRouterLauncherButton: () => HTMLElement): Promise<void> {
  if (readRouterLauncherButton().getAttribute("aria-pressed") !== "true") {
    readRouterLauncherButton().click();
  }

  // The host router devtools can render the panel before the aggregated button state catches up.
  await waitForRouterPanelToBeVisible();
}

interface IStoryLaunchers {
  readQueryLauncherButton: () => HTMLElement;
  readRouterLauncherButton: () => HTMLElement;
}

const setupSharedPlayTest = async ({ canvasElement }: ISharedPlayTestArgs): Promise<IStoryLaunchers> => {
  const canvas = within(canvasElement);
  const readRouterLauncherButton = (): HTMLElement => canvas.getByRole("button", { name: "Router" });
  const readQueryLauncherButton = (): HTMLElement => canvas.getByRole("button", { name: "Query" });

  await canvas.findByRole("button", { name: "Router" });
  await canvas.findByRole("button", { name: "Query" });
  await expect(canvas.getByTestId("ExternalDevtoolsPanel")).toBeInTheDocument();

  await waitForToolbarsToBeHidden(["footer.TanStackRouterDevtools > button"]);
  await waitForToolbarsToBeHidden([".tsqd-open-btn-container", ".tsqd-open-btn", ".tsqd-minimize-btn"]);

  await waitFor(() => {
    expect(readQueryLauncherButton()).toHaveAttribute("aria-pressed", "false");
  });

  return {
    readRouterLauncherButton,
    readQueryLauncherButton,
  };
};

async function runQueryLauncherCycle(readQueryLauncherButton: () => HTMLElement): Promise<void> {
  await waitForQueryPanelToBeClosed();

  readQueryLauncherButton().click();
  await waitForQueryPanelToBeOpen();
  await waitFor(() => {
    expect(readQueryLauncherButton()).toHaveAttribute("aria-pressed", "true");
  });

  readQueryLauncherButton().click();
  await waitForQueryPanelToBeClosed();
  await waitFor(() => {
    expect(readQueryLauncherButton()).toHaveAttribute("aria-pressed", "false");
  });

  await waitForToolbarsToBeHidden([".tsqd-open-btn-container", ".tsqd-open-btn", ".tsqd-minimize-btn"]);
}

const sharedPlayTest = async ({ canvasElement }: ISharedPlayTestArgs): Promise<void> => {
  const { readQueryLauncherButton } = await setupSharedPlayTest({ canvasElement });

  await runQueryLauncherCycle(readQueryLauncherButton);
};

const rightSidePlayTest = async ({ canvasElement }: ISharedPlayTestArgs): Promise<void> => {
  const { readQueryLauncherButton, readRouterLauncherButton } = await setupSharedPlayTest({ canvasElement });

  await runQueryLauncherCycle(readQueryLauncherButton);
  await ensureRouterPanelIsOpen(readRouterLauncherButton);
  await waitForToolbarsToBeHidden(["footer.TanStackRouterDevtools > button"]);
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
  play: rightSidePlayTest,
};
