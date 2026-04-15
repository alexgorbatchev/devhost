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

function IntegratedPanel() {
  const { launchers, toggleLauncher } = useExternalDevtoolsLaunchers(true);

  return (
    <>
      <ThemeProvider colorScheme="dark">
        <StoryContainer align="right">
          <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={toggleLauncher} />
        </StoryContainer>
      </ThemeProvider>

      <QueryClientProvider client={queryClient}>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
      <RouterProvider router={router} />
      <TanStackRouterDevtools router={router} initialIsOpen={false} />
    </>
  );
}

const meta: Meta<typeof ExternalDevtoolsPanel> = {
  title: "@alexgorbatchev/devhost/devtools/features/externalDevtoolsPanel/ExternalDevtoolsPanel",
  component: ExternalDevtoolsPanel,
  render: () => {
    return <IntegratedPanel />;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

interface ISharedPlayTestArgs {
  canvasElement: HTMLElement;
}

type LauncherButtonReader = () => HTMLElement;

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

async function waitForRouterPanelToBeClosed(): Promise<void> {
  await waitFor(() => {
    const routerPanel = document.querySelector(".TanStackRouterDevtoolsPanel");

    if (routerPanel === null) {
      return;
    }

    const style = window.getComputedStyle(routerPanel);

    expect(style.display === "none" || style.visibility === "hidden").toBe(true);
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

interface IStoryLaunchers {
  readQueryLauncherButton: LauncherButtonReader;
  readRouterLauncherButton: LauncherButtonReader;
  storyContainerElement: HTMLElement;
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
    storyContainerElement: canvas.getByTestId("StoryContainer"),
  };
};

async function waitForLaunchersToStayInsideStoryContainer(
  storyContainerElement: HTMLElement,
  readLauncherButtons: LauncherButtonReader[],
): Promise<void> {
  await waitFor(() => {
    const storyRect = storyContainerElement.getBoundingClientRect();

    for (const readLauncherButton of readLauncherButtons) {
      const buttonRect = readLauncherButton().getBoundingClientRect();

      expect(buttonRect.left).toBeGreaterThanOrEqual(storyRect.left);
      expect(buttonRect.right).toBeLessThanOrEqual(storyRect.right);
    }
  });
}

async function runQueryLauncherCycle(readQueryLauncherButton: LauncherButtonReader): Promise<void> {
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

async function runRouterLauncherCycle(
  readRouterLauncherButton: LauncherButtonReader,
  readQueryLauncherButton: LauncherButtonReader,
  storyContainerElement: HTMLElement,
): Promise<void> {
  readRouterLauncherButton().click();
  await waitForRouterPanelToBeVisible();
  await waitForLaunchersToStayInsideStoryContainer(storyContainerElement, [
    readRouterLauncherButton,
    readQueryLauncherButton,
  ]);

  readRouterLauncherButton().click();
  await waitForRouterPanelToBeClosed();
}

const sharedPlayTest = async ({ canvasElement }: ISharedPlayTestArgs): Promise<void> => {
  const { readQueryLauncherButton, readRouterLauncherButton, storyContainerElement } = await setupSharedPlayTest({
    canvasElement,
  });

  await runQueryLauncherCycle(readQueryLauncherButton);
  await runRouterLauncherCycle(readRouterLauncherButton, readQueryLauncherButton, storyContainerElement);
  await waitForToolbarsToBeHidden(["footer.TanStackRouterDevtools > button"]);
};

const Default: Story = {
  play: sharedPlayTest,
};

export { Default as ExternalDevtoolsPanel };
