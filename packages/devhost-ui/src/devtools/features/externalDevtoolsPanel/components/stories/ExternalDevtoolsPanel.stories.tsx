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
import { ReactHookFormHarness } from "../../../../../../.storybook/externalDevtools/ReactHookFormHarness";
import { JotaiHarness } from "../../../../../../.storybook/externalDevtools/JotaiHarness";
import { TanStackHarness } from "../../../../../../.storybook/externalDevtools/TanStackHarness";
import { readScriptRequestsSince, resetJotaiDevtoolsStorage, resetTanStackDevtoolsStorage } from "./helpers";

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

export const TanStackNativePlugins: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    await expect(launcher).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    const shell = within(await within(document.body).findByTestId("tanstack-devtools-panel"));
    await userEvent.click(await shell.findByRole("button", { name: "TanStack Form" }));
    await userEvent.clear(canvas.getByRole("textbox", { name: "Form name" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Form name" }), "Lovelace");
    await userEvent.click(await shell.findByText("devhost-form", { exact: true }));
    await expect(await shell.findAllByText('"Lovelace"', { exact: true })).toHaveLength(2);
    await userEvent.click(shell.getByRole("button", { name: "TanStack Table" }));
    await userEvent.click(await shell.findByRole("button", { name: "State" }));
    await userEvent.click(canvas.getByRole("button", { name: "Toggle Ada selection" }));
    await expect(canvas.getByRole("status", { name: "Table selection" })).toHaveTextContent('{"0":true}');
    await waitFor(() => {
      const selectedKeys = shell.getAllByText('"0":', { exact: true });
      expect(selectedKeys.map((key) => key.parentElement?.textContent?.trim())).toEqual(['"0": true', '"0": true']);
    });
    await userEvent.click(shell.getByRole("button", { name: "TanStack Pacer" }));
    await shell.findByRole("button", { name: "TANSTACK TanStack Pacer" });
    await userEvent.click(canvas.getByRole("button", { name: "Schedule debouncer" }));
    await userEvent.click(await shell.findByText("devhost-debouncer", { exact: true }));
    await userEvent.click(await shell.findByRole("button", { name: "Flush" }));
    await waitFor(() => expect(canvas.getByRole("status", { name: "Debounced result" })).toHaveTextContent("executed"));
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const TanStackLifecycle: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    const root = body.getByTestId("tanstack_devtools");
    await expect(within(root).getByLabelText("Open TanStack Devtools")).not.toBeVisible();
    await userEvent.click(launcher);
    await waitFor(() => expect(body.getByTestId("tanstack-devtools-panel")).toHaveAttribute("data-open", "true"));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(canvas.getByRole("button", { name: "Toggle aggregation" }));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "TanStack" })).toBeNull());
    const nativeOpen = within(root).getByRole("button", { name: "Open TanStack Devtools" });
    await expect(nativeOpen).toBeVisible();
    await userEvent.click(nativeOpen);
    await waitFor(() => expect(body.getByTestId("tanstack-devtools-panel")).toHaveAttribute("data-open", "true"));
    await userEvent.click(canvas.getByRole("button", { name: "Toggle aggregation" }));
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "TanStack" })).toHaveAttribute("aria-pressed", "true"),
    );
    await expect(within(root).getByLabelText("Close TanStack Devtools")).not.toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Remount shell" }));
    await waitFor(() => expect(root.isConnected).toBe(false));
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "TanStack" })).toHaveAttribute("aria-pressed", "true"),
    );
    await expect(body.getByTestId("tanstack-devtools-panel")).toHaveAttribute("data-open", "true");
    await userEvent.click(canvas.getByRole("button", { name: "TanStack" }));
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "TanStack" })).toHaveAttribute("aria-pressed", "false"),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Toggle toolbar mount" }));
    await waitFor(() => expect(document.querySelector("[data-devhost-external-devtools-style]")).toBeNull());
    await expect(body.getByRole("button", { name: "Open TanStack Devtools" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Toggle toolbar mount" }));
    await canvas.findByRole("button", { name: "TanStack" });
    await userEvent.click(canvas.getByRole("button", { name: "Toggle shell" }));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "TanStack" })).toBeNull());
    await expect(body.queryByTestId("tanstack_devtools")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Toggle shell" }));
    await expect(await canvas.findByRole("button", { name: "TanStack" })).toHaveAttribute("aria-pressed", "false");
    await expect(body.getByLabelText("Open TanStack Devtools")).not.toBeVisible();
  },
};

export const TanStackSharedShells: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} hasSecondShell />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    await waitFor(() => expect(document.querySelectorAll('[data-testid="tanstack-devtools-panel"]')).toHaveLength(2));
    await expect(canvas.getAllByRole("button", { name: "TanStack" })).toHaveLength(1);
    await userEvent.click(launcher);
    await waitFor(() => {
      expect(
        [...document.querySelectorAll('[data-testid="tanstack-devtools-panel"]')].map((panel) =>
          panel.getAttribute("data-open"),
        ),
      ).toEqual(["true", "true"]);
      expect(launcher).toHaveAttribute("aria-pressed", "true");
    });
    await userEvent.click(launcher);
    await waitFor(() => {
      expect(
        [...document.querySelectorAll('[data-testid="tanstack-devtools-panel"]')].map((panel) =>
          panel.getAttribute("data-open"),
        ),
      ).toEqual(["false", "false"]);
      expect(launcher).toHaveAttribute("aria-pressed", "false");
    });
  },
};

export const TanStackEmbeddedPlugins: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} hasEmbeddedTools />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    await userEvent.click(launcher);
    const shell = within(within(document.body).getByTestId("tanstack-devtools-panel"));
    const queryPlugin = await shell.findByRole("button", { name: "TanStack Query" });
    const querySelectionStartedAt = performance.now();
    await userEvent.click(queryPlugin);
    await expect(await shell.findByRole("textbox", { name: "Filter queries by query key" })).toBeVisible();
    await expect(readScriptRequestsSince(querySelectionStartedAt)).toEqual([]);
    await userEvent.click(await shell.findByRole("button", { name: "TanStack Router" }));
    await expect(await shell.findByText("TanStack Router", { exact: true })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Query" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Router" })).toBeNull();
    await expect(canvas.getByRole("group", { name: "External devtools" }).textContent).toBe("TanStack");
    await expect(shell.getByRole("button", { name: "Close Tanstack query devtools" })).toBeVisible();
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const TanStackStandaloneCoexistence: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} hasEmbeddedTools hasStandaloneTools />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shellLauncher = await canvas.findByRole("button", { name: "TanStack" });
    const queryLauncher = await canvas.findByRole("button", { name: "Query" });
    const routerLauncher = await canvas.findByRole("button", { name: "Router" });
    await userEvent.click(shellLauncher);
    const shell = within(within(document.body).getByTestId("tanstack-devtools-panel"));
    await userEvent.click(await shell.findByRole("button", { name: "TanStack Query" }));
    await shell.findByRole("textbox", { name: "Filter queries by query key" });
    await userEvent.click(await shell.findByRole("button", { name: "TanStack Router" }));
    await shell.findByText("TanStack Router", { exact: true });
    await expect(queryLauncher).toHaveAttribute("aria-pressed", "false");
    await expect(routerLauncher).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(queryLauncher);
    await waitFor(() => expect(queryLauncher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(queryLauncher);
    await waitFor(() => expect(queryLauncher).toHaveAttribute("aria-pressed", "false"));
    await expect(shell.getByRole("textbox", { name: "Filter queries by query key" })).toBeVisible();
    await userEvent.click(routerLauncher);
    await waitFor(() => expect(routerLauncher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(routerLauncher);
    await waitFor(() => expect(routerLauncher).toHaveAttribute("aria-pressed", "false"));
    await expect(shellLauncher).toHaveAttribute("aria-pressed", "true");
    await expect(shell.getByRole("button", { name: "Close Tanstack query devtools" })).toBeVisible();
    await userEvent.click(shellLauncher);
    await waitFor(() => expect(shellLauncher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const TanStackUrlGated: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} shouldRequireUrlFlag />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await within(document.body).findByTestId("tanstack_devtools");
    await expect(within(document.body).queryByTestId("tanstack-devtools-panel")).toBeNull();
    await expect(canvas.queryByRole("group", { name: "External devtools" })).toBeNull();
    await expect(document.querySelector("[data-devhost-external-devtools-style]")?.textContent).toBe("");
    await userEvent.click(canvas.getByRole("button", { name: "Remove URL gate" }));
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    await expect(launcher).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(launcher);
    await waitFor(() =>
      expect(within(document.body).getByTestId("tanstack-devtools-panel")).toHaveAttribute("data-open", "true"),
    );
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const TanStackHiddenTrigger: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} shouldHideTrigger />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await within(document.body).findByTestId("tanstack-devtools-panel");
    await expect(within(document.body).getByTestId("tanstack-devtools-panel")).toHaveAttribute("data-open", "false");
    await expect(canvas.queryByRole("group", { name: "External devtools" })).toBeNull();
    await expect(
      within(document.body).queryByRole("button", { name: "Open TanStack Devtools", hidden: true }),
    ).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Toggle native libraries" }));
    await userEvent.keyboard("{Control>}~{/Control}");
    await waitFor(() =>
      expect(within(document.body).getByTestId("tanstack-devtools-panel")).toHaveAttribute("data-open", "true"),
    );
    await expect(canvas.queryByRole("group", { name: "External devtools" })).toBeNull();
    await userEvent.click(await within(document.body).findByRole("button", { name: "Close TanStack Devtools" }));
    await waitFor(() =>
      expect(within(document.body).getByTestId("tanstack-devtools-panel")).toHaveAttribute("data-open", "false"),
    );
    await userEvent.keyboard("{Control>}~{/Control}");
    await userEvent.click(await within(document.body).findByRole("button", { name: "Settings" }));
    await userEvent.click(
      await within(document.body).findByRole("checkbox", {
        name: "Completely hide trigger Completely removes the trigger from the DOM (you can still open it with the hotkey)",
      }),
    );
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    await expect(launcher).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const TanStackUnrelatedMarkup: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} hasUnrelatedMarkup />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const documentation = canvas.getByRole("button", { name: "Open TanStack Devtools" });
    await userEvent.click(documentation);
    await expect(documentation).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText("TanStack plugin setup documentation")).toBeVisible();
    await expect(canvas.queryByRole("group", { name: "External devtools" })).toBeNull();
    await expect(document.querySelector("[data-devhost-external-devtools-style]")?.textContent).toBe("");
    await userEvent.click(documentation);
    await expect(documentation).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Toggle shell" }));
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const TanStackNativeCleanup: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    await userEvent.click(launcher);
    const shell = within(await within(document.body).findByTestId("tanstack-devtools-panel"));
    await userEvent.click(await shell.findByRole("button", { name: "TanStack Form" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Form name" }), " cleanup");
    await shell.findByText("devhost-form", { exact: true });
    await userEvent.click(shell.getByRole("button", { name: "TanStack Table" }));
    await shell.findByRole("button", { name: "State" });
    await userEvent.click(shell.getByRole("button", { name: "TanStack Pacer" }));
    await shell.findByRole("button", { name: "TANSTACK TanStack Pacer" });
    await userEvent.click(canvas.getByRole("button", { name: "Schedule debouncer" }));
    await userEvent.click(await shell.findByText("devhost-debouncer", { exact: true }));
    await shell.findByText("pending", { exact: true });
    await userEvent.click(canvas.getByRole("button", { name: "Toggle native libraries" }));
    await expect(canvas.queryByRole("region", { name: "Native TanStack libraries" })).toBeNull();
    await waitFor(() => expect(shell.queryByText("devhost-form", { exact: true })).toBeNull());
    await shell.findByText("No table is connected. Register a table with TanStack Table Devtools to inspect it here.", {
      exact: true,
    });
    await shell.findByText("idle", { exact: true });
    await expect(shell.getAllByText("devhost-debouncer", { exact: true })).toHaveLength(2);
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const TanStackDetachedWindow: Story = {
  beforeEach: resetTanStackDevtoolsStorage,
  render: (_args, context) => <TanStackHarness globals={context.globals} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = await canvas.findByRole("button", { name: "TanStack" });
    await userEvent.click(launcher);
    await userEvent.click(await within(document.body).findByRole("button", { name: "Detach TanStack Devtools" }));
    await waitFor(() => {
      expect(document.querySelector('[data-testid="tanstack_devtools"]')).toBeNull();
      expect(canvas.queryByRole("button", { name: "TanStack" })).toBeNull();
    });
    // Reacquire the upstream-named popup through the standard browser API; no host state is patched.
    const popup = window.open("", "TSDT-Devtools-Panel");
    await expect(popup).not.toBeNull();
    try {
      await waitFor(() =>
        expect(
          popup?.document.querySelector('[data-testid="tanstack-devtools-panel"]')?.getAttribute("data-open"),
        ).toBe("true"),
      );
      await expect(popup?.document.querySelector('[data-testid="tsd-close-button"]')).toBeNull();
    } finally {
      popup?.close();
    }
    await expect(await canvas.findByRole("button", { name: "TanStack" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: "TanStack" }));
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "TanStack" })).toHaveAttribute("aria-pressed", "false"),
    );
  },
};

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

  await userEvent.click(readQueryLauncherButton());
  await waitForQueryPanelToBeOpen();
  await waitFor(() => {
    expect(readQueryLauncherButton()).toHaveAttribute("aria-pressed", "true");
  });

  await userEvent.click(readQueryLauncherButton());
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

export const JotaiCustomStoreLiveHistory: Story = {
  beforeEach: resetJotaiDevtoolsStorage,
  render: (_args, context) => <JotaiHarness globals={context.globals} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = await canvas.findByRole("button", { name: "Jotai 1" });
    const inspector = within(canvas.getByTestId("JotaiHarness--first-inspector"));
    await expect(launcher).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).not.toBeVisible());
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(inspector.getByRole("button", { name: "firstCount" }));
    await expect(inspector.getByText("Raw value", { exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await waitFor(() => expect(inspector.getByTestId("atom-parsed-value")).toHaveTextContent(/^1$/u));
    await userEvent.click(inspector.getByRole("tab", { name: "Time travel" }));
    await userEvent.click(await inspector.findByRole("button", { name: "Record snapshot history" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await inspector.findByRole("button", { name: "1" });
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await inspector.findByRole("button", { name: "2" });
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await inspector.findByRole("button", { name: "3" });
    await userEvent.click(inspector.getByRole("button", { name: "Stop recording snapshot history" }));
    await userEvent.click(inspector.getByTitle("Restore next snapshot"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("2"));
    await userEvent.click(inspector.getByTitle("Restore next snapshot"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("3"));
    await userEvent.click(inspector.getByTitle("Restore previous snapshot"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("2"));
    await userEvent.click(inspector.getByTitle("Start time travel"));
    await waitFor(() => {
      expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("4");
      expect(inspector.getByTitle("Start time travel")).toBeVisible();
    });
    await userEvent.click(inspector.getByRole("button", { name: "2" }));
    await waitFor(() => expect(inspector.getByTitle("Restore this state")).toBeEnabled());
    await userEvent.click(inspector.getByTitle("Restore this state"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("3"));
    await userEvent.click(inspector.getByTitle("Minimize panel"));
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).not.toBeVisible());
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const JotaiMultipleStores: Story = {
  beforeEach: resetJotaiDevtoolsStorage,
  render: (_args, context) => <JotaiHarness globals={context.globals} hasSecondStore />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = await canvas.findByRole("button", { name: "Jotai 1" });
    const second = await canvas.findByRole("button", { name: "Jotai 2" });
    const inspector = within(canvas.getByTestId("JotaiHarness--second-inspector"));
    await userEvent.click(second);
    await waitFor(() => expect(second).toHaveAttribute("aria-pressed", "true"));
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(inspector.getByRole("button", { name: "secondCount" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment second" }));
    await waitFor(() => expect(inspector.getByTestId("atom-parsed-value")).toHaveTextContent(/^101$/u));
    await expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("0");
    await userEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-pressed", "true"));
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-pressed", "false"));
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(second);
    await waitFor(() => expect(second).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(first);
    const firstInspector = within(canvas.getByTestId("JotaiHarness--first-inspector"));
    await userEvent.click(firstInspector.getByRole("tab", { name: "Time travel" }));
    await userEvent.click(await firstInspector.findByRole("button", { name: "Record snapshot history" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await firstInspector.findByRole("button", { name: "1" });
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await firstInspector.findByRole("button", { name: "2" });
    await userEvent.click(firstInspector.getByRole("button", { name: "Stop recording snapshot history" }));
    await userEvent.click(firstInspector.getByTitle("Restore next snapshot"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent(/^1$/u));
    await expect(canvas.getByRole("status", { name: "second value" })).toHaveTextContent(/^101$/u);
    await userEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(canvas.getByRole("button", { name: "Remount first inspector" }));
    const replacement = await canvas.findByRole("button", { name: "Jotai 3" });
    await expect(canvas.queryByRole("button", { name: "Jotai 1" })).toBeNull();
    await userEvent.click(replacement);
    await waitFor(() => expect(replacement).toHaveAttribute("aria-pressed", "true"));
    await expect(second).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(replacement);
    await waitFor(() => expect(replacement).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(canvas.getByRole("button", { name: "Toggle first inspector" }));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Jotai 3" })).toBeNull());
    await expect(second).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByRole("status", { name: "second value" })).toHaveTextContent("101");
  },
};

export const JotaiLifecycle: Story = {
  beforeEach: resetJotaiDevtoolsStorage,
  render: (_args, context) => <JotaiHarness globals={context.globals} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("button", { name: "Jotai 1" });
    const inspector = within(canvas.getByTestId("JotaiHarness--first-inspector"));
    await userEvent.click(canvas.getByRole("button", { name: "Remount first inspector" }));
    await canvas.findByRole("button", { name: "Jotai 2" });
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).not.toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Toggle aggregation" }));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).toBeVisible());
    await userEvent.click(inspector.getByTitle("Open Jotai Devtools"));
    await inspector.findByTitle("Minimize panel");
    await userEvent.click(canvas.getByRole("button", { name: "Toggle aggregation" }));
    const launcher = await canvas.findByRole("button", { name: "Jotai 2" });
    await expect(launcher).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(inspector.getByTitle("Minimize panel"));
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).not.toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Toggle toolbar mount" }));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).toBeVisible());
    await userEvent.click(inspector.getByTitle("Open Jotai Devtools"));
    await inspector.findByTitle("Minimize panel");
    await userEvent.click(inspector.getByTitle("Minimize panel"));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).toBeVisible());
  },
};
