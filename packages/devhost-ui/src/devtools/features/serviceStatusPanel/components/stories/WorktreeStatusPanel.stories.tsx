import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "storybook/test";
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
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees", exact: true }));
    await userEvent.click(await canvas.findByRole("button", { name: "Choose worktree for shop" }));
    await waitFor(() => expect(canvas.getByRole("region", { name: "shop · Worktrees" })).toBeVisible());
    await waitFor(() => expect(args.onRefreshWorktrees).toHaveBeenCalledOnce());
    const alternative = await canvas.findByRole("radio", { name: "feature/cart /worktrees/cart" });
    await waitFor(() => expect(alternative).toBeEnabled());
    await userEvent.click(alternative);
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart stack", exact: true }));
    await expect(args.onSwitchWorktree).toHaveBeenCalledWith("shop", "/worktrees/cart");
    const chooser = await canvas.findByRole("button", { name: "Choose worktree for shop" });
    await waitFor(() => expect(Reflect.get(chooser.getRootNode(), "activeElement")).toBe(chooser));
  },
};

export const SwitchingStack: Story = {
  args: { repositories: [{ ...factory_worktreeRepository(), switching: true }] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees", exact: true }));
    await userEvent.click(await canvas.findByRole("button", { name: "Choose worktree for shop" }));
    await expect(await canvas.findByRole("button", { name: "Switch and restart stack" })).toBeDisabled();
    await waitFor(() => expect(canvas.getByText("Switching and restarting stack…")).toBeVisible());
    for (const radio of canvas.getAllByRole("radio")) await expect(radio).toBeDisabled();
    await userEvent.click(canvas.getAllByRole("button", { name: "Back to worktrees", exact: true })[0]);
    await expect(await canvas.findByRole("button", { name: "Choose worktree for shop" })).toBeVisible();
  },
};

export const UnavailableCheckout: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees", exact: true }));
    await userEvent.click(await canvas.findByRole("button", { name: "Choose worktree for shop" }));
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
