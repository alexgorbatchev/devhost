import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import { ToolbarPopover } from "../../../../shared/components/ToolbarPopover";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "../../../../shared/components/stories/helpers";
import { WorktreePicker } from "../WorktreePicker";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../../../../shared/constants";
import { readInjectedDevtoolsConfig } from "../../../../shared/readInjectedDevtoolsConfig";
import { factory_homeWorktreeRepository, factory_worktreeRepository } from "./fixtures";

const meta: Meta<typeof WorktreePicker> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/serviceStatusPanel/components/WorktreePicker",
  component: WorktreePicker,
  args: {
    repository: factory_worktreeRepository(),
    hasRestartingService: false,
    onBack: fn(),
    onRefresh: fn(async () => null),
    onSwitch: fn(async () => null),
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <ToolbarPopover
            panelLabel="shop · Worktrees"
            panelWidth="lg"
            testId="WorktreePickerStory"
            triggerContent="Worktrees"
            triggerLabel="Worktrees"
          >
            <WorktreePicker {...args} />
          </ToolbarPopover>
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};
export default meta;
type Story = StoryObj<typeof meta>;

export const FuzzySearch: Story = {
  render: (args, context) => (
    <StorybookThemeProvider globals={context.globals}>
      <WorktreePicker {...args} />
    </StorybookThemeProvider>
  ),
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole("searchbox", { name: "Find worktree" });
    await waitFor(() => expect(search).toHaveFocus());
    await userEvent.type(search, "FCRT");
    await expect(canvas.getAllByRole("radio")).toHaveLength(1);
    const feature = canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" });
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Refresh worktrees" })).toHaveFocus();
    await userEvent.tab();
    await expect(feature).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(feature).toBeChecked();
    await userEvent.clear(search);
    await expect(canvas.getAllByRole("radio")).toHaveLength(4);
    await userEvent.type(search, "wtsexp");
    await expect(canvas.getAllByRole("radio")).toHaveLength(1);
    await expect(canvas.getByRole("radio", { name: "Detached deadbee /worktrees/experiment" })).toBeVisible();
    await userEvent.clear(search);
    await userEvent.type(search, "deadbee");
    await expect(canvas.getAllByRole("radio")).toHaveLength(1);
    await userEvent.clear(search);
    await userEvent.type(search, "zzzzzz");
    await expect(canvas.queryByRole("radio")).not.toBeInTheDocument();
    await expect(canvas.getByRole("status")).toHaveTextContent("No matching worktrees.");
    await expect(args.onSwitch).not.toHaveBeenCalled();
    await userEvent.clear(search);
    await expect(canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" })).toBeChecked();
    await expect(canvas.getByRole("radio", { name: "feature/missing /worktrees/missing" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart 2 services" }));
    await expect(args.onSwitch).toHaveBeenCalledWith("shop", "/worktrees/cart");
  },
};

export const HomeDirectoryPaths: Story = {
  args: { repository: factory_homeWorktreeRepository() },
  beforeEach: () => {
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
      ...readInjectedDevtoolsConfig(),
      homeDirectoryPath: "/home/alex",
    });
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    const main = canvas.getByRole("radio", { name: "main ~/projects/shop" });
    await waitFor(() => {
      expect(main).toBeEnabled();
      expect(main).toBeVisible();
    });
    await waitFor(() => {
      expect(canvas.getByText("~/projects/shop")).toBeVisible();
      expect(canvas.getByText("~/projects/shop/api")).toBeVisible();
    });
    const feature = canvas.getByRole("radio", { name: "feature/cart ~/worktrees/cart" });
    await userEvent.click(feature);
    await expect(feature).toBeChecked();
    await waitFor(() => expect(canvas.getByText("~/worktrees/cart/web")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart 2 services" }));
    await expect(args.onSwitch).toHaveBeenCalledWith("shop", "/home/alex/worktrees/cart");
  },
};

export const ChoicesAndPreview: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    const main = canvas.getByRole("radio", { name: "main /projects/shop" });
    await waitFor(() => {
      expect(main).toBeEnabled();
      expect(main).toBeVisible();
    });
    await expect(main).toBeChecked();
    await expect(canvas.getByRole("button", { name: "Switch and restart 2 services" })).toBeDisabled();
    await userEvent.click(main);
    await userEvent.click(canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" }));
    await expect(canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" })).toBeChecked();
    await waitFor(() => expect(canvas.getByText("/worktrees/cart/web")).toBeVisible());
    await expect(canvas.getByRole("radio", { name: "feature/missing /worktrees/missing" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart 2 services" }));
    await expect(args.onSwitch).toHaveBeenCalledWith("shop", "/worktrees/cart");
    await waitFor(() => expect(args.onBack).toHaveBeenCalled());
  },
};

export const DetachedCheckout: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    const detached = canvas.getByRole("radio", { name: "Detached deadbee /worktrees/experiment" });
    await waitFor(() => {
      expect(detached).toBeEnabled();
      expect(detached).toBeVisible();
    });
    await userEvent.click(detached);
    await waitFor(() => expect(canvas.getByText("/worktrees/experiment/api")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart 2 services" }));
    await expect(args.onSwitch).toHaveBeenCalledWith("shop", "/worktrees/experiment");
  },
};

export const ExternalService: Story = {
  args: {
    repository: {
      ...factory_worktreeRepository(),
      blockedReason: "Service api is external; devhost cannot switch every service in this repository.",
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    const feature = canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" });
    await waitFor(() => expect(feature).toBeEnabled());
    await userEvent.click(feature);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Service api is external; devhost cannot switch every service in this repository.",
    );
    await expect(canvas.getByRole("button", { name: "Switch and restart 2 services" })).toBeDisabled();
  },
};

export const Switching: Story = {
  args: { repository: { ...factory_worktreeRepository(), selectedPath: "/worktrees/cart", switching: true } },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    await waitFor(() => expect(canvas.getByRole("status")).toHaveTextContent("Switching and restarting services…"));
    await expect(canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" })).toBeDisabled();
    const back = canvas.getByRole("button", { name: "Back to services" });
    await expect(canvas.getByRole("status").getBoundingClientRect().bottom).toBeLessThanOrEqual(
      back.getBoundingClientRect().top,
    );
    await userEvent.click(back);
    await expect(args.onBack).toHaveBeenCalled();
  },
};

export const FailedSelection: Story = {
  args: {
    repository: {
      ...factory_worktreeRepository(),
      selectedPath: "/worktrees/cart",
      runningPath: "",
      error: "web failed to start; repository services are stopped.",
    },
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Retry" })).toBeEnabled());
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onSwitch).toHaveBeenCalledWith("shop", "/worktrees/cart");
    await userEvent.click(canvas.getByRole("button", { name: "Return to configured checkout" }));
    await expect(args.onSwitch).toHaveBeenCalledWith("shop", "/projects/shop");
  },
};

export const MissingSavedSelection: Story = {
  args: {
    repository: {
      ...factory_worktreeRepository(),
      selectedPath: "/worktrees/missing",
      runningPath: "",
      error: "Saved checkout is unavailable.",
    },
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Return to configured checkout" })).toBeEnabled());
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Return to configured checkout" }));
    await expect(args.onSwitch).toHaveBeenCalledWith("shop", "/projects/shop");
  },
};

export const Loading: Story = {
  args: { onRefresh: fn(() => new Promise<string | null>(() => {})) },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading worktrees…");
    await expect(canvas.getByRole("radio", { name: "main /projects/shop" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(args.onBack).toHaveBeenCalled();
  },
};

export const RefreshFailure: Story = {
  args: { onRefresh: fn(async () => "Git is unavailable.") },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("Git is unavailable."));
    await expect(canvas.getByRole("radio", { name: "main /projects/shop" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Refresh worktrees" })).toBeEnabled();
  },
};

export const LaunchFailure: Story = {
  args: { onSwitch: fn(async () => "Service web failed to start.") },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    const feature = canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" });
    await waitFor(() => expect(feature).toBeEnabled());
    await userEvent.click(feature);
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart 2 services" }));
    await waitFor(() => expect(canvas.getByRole("alert")).toHaveTextContent("Service web failed to start."));
    await expect(args.onBack).not.toHaveBeenCalled();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeEnabled();
  },
};

export const ServiceRestartInProgress: Story = {
  args: { hasRestartingService: true },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    const feature = canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" });
    await waitFor(() => expect(feature).toBeEnabled());
    await userEvent.click(feature);
    await expect(canvas.getByRole("button", { name: "Switch and restart 2 services" })).toBeDisabled();
  },
};
