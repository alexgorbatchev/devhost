import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/production";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsInProd as TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within, waitFor } from "storybook/test";

import { DevtoolsToolbar } from "@/devtools/shared/components/DevtoolsToolbar";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";
import { ExternalDevtoolsPanel } from "../ExternalDevtoolsPanel";
import { useExternalDevtoolsLaunchers } from "../../hooks/useExternalDevtoolsLaunchers";
import { ReactHookFormHarness } from "./fixtures/ReactHookFormHarness";

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
  globals: Partial<Record<string, unknown>>;
}

function IntegratedPanel({ globals }: IIntegratedPanelProps) {
  const { launchers, toggleLauncher } = useExternalDevtoolsLaunchers(true);

  return (
    <>
      <StorybookThemeProvider globals={globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={toggleLauncher} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>

      <QueryClientProvider client={queryClient}>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
      <RouterProvider router={router} />
      <TanStackRouterDevtools router={router} initialIsOpen={false} />
    </>
  );
}

const meta: Meta<typeof ExternalDevtoolsPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/externalDevtoolsPanel/components/ExternalDevtoolsPanel",
  component: ExternalDevtoolsPanel,
  render: (_args, context) => {
    return <IntegratedPanel globals={context.globals} />;
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
}

const setupSharedPlayTest = async ({ canvasElement }: ISharedPlayTestArgs): Promise<IStoryLaunchers> => {
  const canvas = within(canvasElement);
  const readRouterLauncherButton = (): HTMLElement => canvas.getByRole("button", { name: "Router" });
  const readQueryLauncherButton = (): HTMLElement => canvas.getByRole("button", { name: "Query" });

  await canvas.findByRole("button", { name: "Router" });
  await canvas.findByRole("button", { name: "Query" });
  await expect(canvas.getByRole("group", { name: "External devtools" })).toBeVisible();

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

async function waitForLaunchersToStayInsideViewport(readLauncherButtons: LauncherButtonReader[]): Promise<void> {
  await waitFor(() => {
    for (const readLauncherButton of readLauncherButtons) {
      const buttonRect = readLauncherButton().getBoundingClientRect();

      expect(buttonRect.left).toBeGreaterThanOrEqual(0);
      expect(buttonRect.right).toBeLessThanOrEqual(window.innerWidth);
      expect(buttonRect.bottom).toBeLessThanOrEqual(window.innerHeight);
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
): Promise<void> {
  readRouterLauncherButton().click();
  await waitForRouterPanelToBeVisible();
  await waitForLaunchersToStayInsideViewport([readRouterLauncherButton, readQueryLauncherButton]);

  readRouterLauncherButton().click();
  await waitForRouterPanelToBeClosed();
}

const sharedPlayTest = async ({ canvasElement }: ISharedPlayTestArgs): Promise<void> => {
  const { readQueryLauncherButton, readRouterLauncherButton } = await setupSharedPlayTest({ canvasElement });

  await runQueryLauncherCycle(readQueryLauncherButton);
  await runRouterLauncherCycle(readRouterLauncherButton, readQueryLauncherButton);
  await waitForToolbarsToBeHidden(["footer.TanStackRouterDevtools > button"]);
};

export const Default: Story = {
  play: sharedPlayTest,
};

export const ReactHookForm: Story = {
  render: (_args, context) => <ReactHookFormHarness globals={context.globals} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = await canvas.findByRole("button", { name: "Form 1" });
    await expect(launcher).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    const inspector = within(canvas.getByTestId("ReactHookFormHarness--profile-inspector"));
    await expect(inspector.getByText("email", { exact: true })).toBeVisible();
    await userEvent.click(inspector.getByTitle("Toggle entire fields"));
    await expect(inspector.getByTestId("email-field-value")).toHaveTextContent("first@example.test");
    await userEvent.clear(canvas.getByRole("textbox", { name: "Email" }));
    await expect(await inspector.findByText("Email required", { exact: true })).toBeVisible();
    await userEvent.type(canvas.getByRole("textbox", { name: "Email" }), "updated@example.test");
    await waitFor(() => expect(inspector.getByTestId("email-field-value")).toHaveTextContent("updated@example.test"));
    await waitFor(() => expect(inspector.queryByText("Email required", { exact: true })).toBeNull());
    await userEvent.click(inspector.getByTitle("Toggle entire fields"));
    await userEvent.click(inspector.getByTitle("Close dev panel"));
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(inspector.getByTitle("Show dev panel")).not.toBeVisible());
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const ReactHookFormMultipleInspectors: Story = {
  render: (_args, context) => <ReactHookFormHarness globals={context.globals} hasSecondForm />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const profileLauncher = await canvas.findByRole("button", { name: "Form 1" });
    const accountLauncher = await canvas.findByRole("button", { name: "Form 2" });
    const profile = within(canvas.getByTestId("ReactHookFormHarness--profile-inspector"));
    const account = within(canvas.getByTestId("ReactHookFormHarness--account-inspector"));
    await userEvent.click(accountLauncher);
    await waitFor(() => expect(accountLauncher).toHaveAttribute("aria-pressed", "true"));
    await expect(profileLauncher).toHaveAttribute("aria-pressed", "false");
    await expect(account.getByText("username", { exact: true })).toBeVisible();
    await waitFor(() => expect(profile.getByTitle("Show dev panel")).not.toBeVisible());
    await userEvent.click(profileLauncher);
    await waitFor(() => expect(profileLauncher).toHaveAttribute("aria-pressed", "true"));
    await expect(accountLauncher).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(profile.getByTitle("Close dev panel"));
    await waitFor(() => expect(profileLauncher).toHaveAttribute("aria-pressed", "false"));
    await expect(accountLauncher).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(accountLauncher);
    await waitFor(() => expect(accountLauncher).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(canvas.getByRole("button", { name: "Remount profile inspector" }));
    const replacementLauncher = await canvas.findByRole("button", { name: "Form 3" });
    await expect(canvas.queryByRole("button", { name: "Form 1" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Form 2" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(replacementLauncher);
    await waitFor(() => expect(replacementLauncher).toHaveAttribute("aria-pressed", "true"));
    await expect(accountLauncher).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(replacementLauncher);
    await waitFor(() => expect(replacementLauncher).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(canvas.getByRole("button", { name: "Toggle profile inspector" }));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Form 3" })).toBeNull());
    await expect(accountLauncher).toHaveAttribute("aria-pressed", "false");
  },
};

export const ReactHookFormLifecycle: Story = {
  render: (_args, context) => <ReactHookFormHarness globals={context.globals} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("button", { name: "Form 1" });
    const inspector = within(canvas.getByTestId("ReactHookFormHarness--profile-inspector"));
    await waitFor(() => expect(inspector.getByTitle("Show dev panel")).not.toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Remount profile inspector" }));
    await canvas.findByRole("button", { name: "Form 2" });
    await waitFor(() => expect(inspector.getByTitle("Show dev panel")).not.toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Toggle aggregation" }));
    await waitFor(() => expect(inspector.getByTitle("Show dev panel")).toBeVisible());
    await expect(canvas.queryByRole("group", { name: "External devtools" })).toBeNull();
    await userEvent.click(inspector.getByLabelText("React Hook Form Logo", { selector: "svg" }));
    await waitFor(() => expect(inspector.queryByTitle("Show dev panel")).toBeNull());
    await userEvent.click(canvas.getByRole("button", { name: "Toggle aggregation" }));
    const openLauncher = await canvas.findByRole("button", { name: "Form 2" });
    await expect(openLauncher).toHaveAttribute("aria-pressed", "true");
    await expect(inspector.getByText("email", { exact: true })).toBeVisible();
    await userEvent.click(inspector.getByTitle("Close dev panel"));
    await waitFor(() => expect(openLauncher).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(inspector.getByTitle("Show dev panel")).not.toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Toggle toolbar mount" }));
    await waitFor(() => expect(inspector.getByTitle("Show dev panel")).toBeVisible());
    await expect(canvas.queryByRole("group", { name: "External devtools" })).toBeNull();
    await userEvent.click(inspector.getByLabelText("React Hook Form Logo", { selector: "svg" }));
    await waitFor(() => expect(inspector.queryByTitle("Show dev panel")).toBeNull());
    await userEvent.click(inspector.getByTitle("Close dev panel"));
    await waitFor(() => expect(inspector.getByTitle("Show dev panel")).toBeVisible());
  },
};
