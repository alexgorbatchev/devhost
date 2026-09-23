import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { DevtoolsToolbar } from "@/devtools/shared/components/DevtoolsToolbar";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { TerminalSessionChips } from "../TerminalSessionChips";
import { factory_agentSessions, fixture_agentSession, fixture_editorSession } from "./fixtures";

const meta: Meta<typeof TerminalSessionChips> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/terminalSessions/components/TerminalSessionChips",
  component: TerminalSessionChips,
  args: {
    onExpandSession: fn(),
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    sessions: [
      { ...fixture_agentSession, status: "working" },
      { ...fixture_editorSession, isExpanded: false, status: "exited" },
    ],
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <TerminalSessionChips {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const agentChip = await shadowCanvas.findByRole("button", { name: "Pi terminal, working" });

    await expect(agentChip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(agentChip);
    await expect(args.onExpandSession).toHaveBeenCalledWith("session-1");

    await expect(shadowCanvas.getByRole("button", { name: "<PrimaryButton> terminal, finished" })).toBeVisible();
    await expect(shadowCanvas.queryByRole("button", { name: "Close Pi session" })).toBeNull();
    await userEvent.click(shadowCanvas.getByRole("button", { name: "Close <PrimaryButton> session" }));
    await expect(args.onRemoveSession).toHaveBeenCalledWith("editor-session-1");
  },
};

export const ExpandedSession: Story = {
  args: {
    sessions: [{ ...fixture_agentSession, isExpanded: true, status: "running" }],
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const agentChip = await shadowCanvas.findByRole("button", { name: "Pi terminal, running" });

    await expect(agentChip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(agentChip);
    await expect(args.onMinimizeSession).toHaveBeenCalledWith("session-1");
  },
};

export const Overflow: Story = {
  args: {
    sessions: factory_agentSessions(16),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const overflowTrigger = await shadowCanvas.findByRole("button", { name: /^All terminal sessions \(\d+ more\)$/ });
    const toolbar = shadowCanvas.getByRole("toolbar", { name: "devhost" });
    const visibleChipCount: number = within(toolbar).getAllByRole("button", { name: / terminal, / }).length;

    await expect(visibleChipCount).toBeLessThan(16);
    await expect(overflowTrigger).toHaveAccessibleName(`All terminal sessions (${16 - visibleChipCount} more)`);
    await expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);

    await userEvent.click(overflowTrigger);

    const panel = await shadowCanvas.findByRole("region", { name: "Terminal sessions" });

    await waitFor(() => expect(panel).toBeVisible());
    await expect(within(panel).getAllByRole("listitem")).toHaveLength(16);

    await userEvent.click(within(panel).getByRole("button", { name: "Open Agent 16 terminal" }));
    await expect(args.onExpandSession).toHaveBeenCalledWith("agent-session-16");
    await waitFor(() => expect(overflowTrigger).toHaveAttribute("aria-expanded", "false"));
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(await shadowCanvas.findByRole("toolbar", { name: "devhost" })).toBeVisible();
    await expect(shadowCanvas.queryByRole("group", { name: "Terminal sessions" })).toBeNull();
  },
};
