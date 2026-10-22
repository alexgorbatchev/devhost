import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { WorktreeStatusPanel } from "../WorktreeStatusPanel";
import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { factory_worktreeRepository } from "./fixtures";

const meta: Meta<typeof WorktreeStatusPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/serviceStatusPanel/components/WorktreeStatusPanel",
  component: WorktreeStatusPanel,
  args: {
    repositories: [factory_worktreeRepository()],
    services: [{ name: "web", managed: true, status: true }],
    onRefreshWorktrees: fn(async () => null),
    onSwitchWorktree: fn(async () => null),
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <WorktreeStatusPanel {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};
export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultBranch: Story = {
  play: async ({ canvasElement, args }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Worktrees", exact: true });
    await expect(trigger.textContent).toBe("main");
    await expect(getComputedStyle(within(trigger).getByTestId("Icon")).color).toBe(getComputedStyle(trigger).color);
    await expect(args.onRefreshWorktrees).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getByRole("region", { name: "Worktrees" })).toBeVisible());
    await waitFor(() => expect(args.onRefreshWorktrees).toHaveBeenCalledOnce());
    const alternative = await canvas.findByRole("radio", { name: "feature/cart /worktrees/cart" });
    await waitFor(() => expect(alternative).toBeEnabled());
    await userEvent.click(alternative);
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart stack", exact: true }));
    await expect(args.onSwitchWorktree).toHaveBeenCalledWith("shop", "/worktrees/cart");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    await waitFor(() => expect(Reflect.get(trigger.getRootNode(), "activeElement")).toBe(trigger));
    await userEvent.click(trigger);
    await waitFor(() => expect(args.onRefreshWorktrees).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(canvas.getByRole("radio", { name: "main /projects/shop" })).toBeChecked());
  },
};

export const SwitchingStack: Story = {
  args: { repositories: [{ ...factory_worktreeRepository(), switching: true }] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees", exact: true }));
    await expect(await canvas.findByRole("button", { name: "Switch and restart stack" })).toBeDisabled();
    await waitFor(() => expect(canvas.getByText("Switching and restarting stack…")).toBeVisible());
    for (const radio of canvas.getAllByRole("radio")) await expect(radio).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Close", exact: true }));
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Worktrees", exact: true })).toHaveAttribute("aria-expanded", "false"),
    );
  },
};

export const UnavailableCheckout: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees", exact: true }));
    await expect(await canvas.findByRole("radio", { name: "feature/missing /worktrees/missing" })).toBeDisabled();
    await expect(canvas.getByText("Checkout directory is missing.")).not.toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Why feature/missing is unavailable" }));
    await waitFor(() => expect(canvas.getByText("Checkout directory is missing.")).toBeVisible());
  },
};

export const NoRepositories: Story = {
  args: { repositories: [] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(canvas.queryByRole("button", { name: /Worktrees/ })).toBeNull();
  },
};

export const MissingSelectedCheckout: Story = {
  args: { repositories: [{ ...factory_worktreeRepository(), selectedPath: "/worktrees/deleted", runningPath: "" }] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Worktrees, attention required", exact: true });
    await expect(trigger.textContent).toBe("");
    await expect(getComputedStyle(within(trigger).getByTestId("Icon")).color).not.toBe(getComputedStyle(trigger).color);
    await userEvent.click(trigger);
    const main = await canvas.findByRole("radio", { name: "main /projects/shop" });
    await waitFor(() => expect(main).toBeEnabled());
    await userEvent.click(main);
    await expect(canvas.getByRole("button", { name: "Switch and restart stack" })).toBeEnabled();
  },
};

export const RepositoryError: Story = {
  args: {
    repositories: [
      factory_worktreeRepository(),
      { ...factory_worktreeRepository(), id: "other", name: "other", error: "Service failed to start." },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Worktrees, attention required", exact: true });
    await expect(trigger.textContent).toBe("shop: main, other: main");
    await expect(canvas.queryByText("Service failed to start.")).toBeNull();
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getByRole("region", { name: "Worktrees" })).toBeVisible());
    await userEvent.click(canvas.getByRole("combobox", { name: "Repository" }));
    await userEvent.click(await canvas.findByRole("option", { name: "other" }));
    await waitFor(() => expect(canvas.getByText("Service failed to start.")).toBeVisible());
    // Escape in the open list closes the list and leaves the panel open.
    await userEvent.click(canvas.getByRole("combobox", { name: "Repository" }));
    await canvas.findByRole("listbox");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("listbox")).toBeNull());
    await expect(canvas.getByRole("region", { name: "Worktrees" })).toBeVisible();
  },
};

export const UnavailableSelection: Story = {
  args: { repositories: [{ ...factory_worktreeRepository(), selectedPath: "/worktrees/missing", runningPath: "" }] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await canvas.findByRole("button", {
      name: "Worktrees, non-default branches: shop: feature/missing, attention required",
      exact: true,
    });
    await expect(trigger.textContent).toBe("feature/missing");
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getByRole("region", { name: "Worktrees" })).toBeVisible());
    await expect(await canvas.findByRole("radio", { name: "feature/missing /worktrees/missing" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Why feature/missing is unavailable" }));
    await waitFor(() => expect(canvas.getByText("Checkout directory is missing.")).toBeVisible());
  },
};

export const BlockedRepository: Story = {
  args: {
    repositories: [{ ...factory_worktreeRepository(), blockedReason: "Externally managed services cannot switch." }],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Worktrees, attention required", exact: true });
    await expect(trigger.textContent).toBe("main");
    await userEvent.click(trigger);
    await waitFor(() => expect(canvas.getByText("Externally managed services cannot switch.")).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Switch and restart stack" })).toBeDisabled();
  },
};
