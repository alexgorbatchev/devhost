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
import { expect, userEvent, within, waitFor } from "storybook/test";

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

type CheckIsOpenCallback = (panelElement: Element) => boolean;

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

  const testDevtoolsCycle = async (
    buttonName: string,
    panelSelector: string,
    originalToolbarSelectors: string[],
    isOpen: CheckIsOpenCallback,
  ): Promise<void> => {
    const launcherButton = canvas.getByRole("button", { name: buttonName });

    const verifyToolbarsHidden = (): void => {
      for (const selector of originalToolbarSelectors) {
        const originalToolbar = document.querySelector(selector);
        if (originalToolbar) {
          expect(window.getComputedStyle(originalToolbar).display).toBe("none");
        }
      }
    };

    // 1. Wait until panel is closed and toolbars are hidden
    await waitFor(
      () => {
        // Just verify toolbars hidden here since injection takes a bit
        let anyToolbarVisible = false;
        for (const selector of originalToolbarSelectors) {
          const originalToolbar = document.querySelector(selector);
          if (originalToolbar) {
            const display = window.getComputedStyle(originalToolbar).display;
            if (display !== "none") {
              anyToolbarVisible = true;
            }
          }
        }

        expect(anyToolbarVisible).toBe(false);
      },
      { timeout: 10000 },
    );

    // 3. Click to open
    await userEvent.click(launcherButton);

    // 4. Verify panel is open
    await waitFor(
      () => {
        const openPanel = document.querySelector(panelSelector);
        if (openPanel) {
          expect(isOpen(openPanel)).toBe(true);
        } else {
          expect(openPanel).not.toBeNull();
        }
      },
      { timeout: 3000 },
    );

    // Wait for the opening animation to fully settle before clicking close
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 5. Click to close
    await userEvent.click(launcherButton);

    // 6. Wait to ensure animations finish if any exist
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 7. Click one more time to make sure it's fully dismissed if stuck
    const openPanelCheck = document.querySelector(panelSelector);
    if (openPanelCheck && isOpen(openPanelCheck)) {
      await userEvent.click(launcherButton);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // 8. Verify panel is closed again
    await waitFor(
      () => {
        const panel = document.querySelector(panelSelector);
        if (panel) {
          expect(isOpen(panel)).toBe(false);
        }
      },
      { timeout: 10000 },
    );

    // 8. Original toolbars are still hidden
    verifyToolbarsHidden();
  };

  // Wait a little extra time on the first cycle for Tanstack Query to fully unmount
  await new Promise((resolve) => setTimeout(resolve, 2000));

  await testDevtoolsCycle(
    "Router",
    ".TanStackRouterDevtoolsPanel",
    ["footer.TanStackRouterDevtools > button"],
    (panel) => {
      const style = window.getComputedStyle(panel);
      const isOpacityZero = style.opacity === "0";
      const isDisplayNone = style.display === "none";

      return panel.isConnected && !isDisplayNone && style.visibility !== "hidden" && !isOpacityZero;
    },
  );

  // Tanstack Query panel opens asynchronously and has an initial animation phase.
  // When it starts it could be immediately briefly present.
  // Wait to make sure we don't accidentally test it while it's still animating initial state
  await new Promise((resolve) => setTimeout(resolve, 500));

  // We explicitly await the disappearance of the query panel to avoid flaky closes
  await testDevtoolsCycle(
    "Query",
    ".tsqd-main-panel",
    [".tsqd-open-btn-container", ".tsqd-open-btn", ".tsqd-minimize-btn"],
    (panel) => {
      const parent = panel.closest(".tsqd-parent-container") || panel;
      const style = window.getComputedStyle(parent);
      const isOpacityZero = style.opacity === "0";
      const isDisplayNone = style.display === "none";

      console.log("Checking isOpen for Query panel:", {
        opacity: style.opacity,
        display: style.display,
        visibility: style.visibility,
        isConnected: panel.isConnected,
        className: panel.className,
        parentClassName: parent.className,
      });

      return panel.isConnected && !isDisplayNone && style.visibility !== "hidden" && !isOpacityZero;
    },
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
