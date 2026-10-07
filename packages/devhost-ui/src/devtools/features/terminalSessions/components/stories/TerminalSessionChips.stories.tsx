import type { Meta, StoryObj } from "@storybook/react";
import { useState, type JSX } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { Button } from "@/devtools/shared";
import { DevtoolsToolbar } from "@/devtools/shared/components/DevtoolsToolbar";
import { ToolbarSegment } from "@/devtools/shared/components/ToolbarSegment";
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

/** A neighbouring toolbar segment that takes more room on request, as the services segment does when a stack grows. */
function GrowingSegment(): JSX.Element {
  const [isWide, setIsWide] = useState<boolean>(false);

  return (
    <ToolbarSegment ariaLabel="Services">
      <Button onClick={(): void => setIsWide(true)}>Grow</Button>
      {isWide ? <span style={{ flexShrink: 0, width: "calc(100vw - 280px)" }}>eight more services</span> : null}
    </ToolbarSegment>
  );
}

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

/** The chips give up room when a neighbouring segment grows, even though nothing about the sessions changed. */
export const FoldsWhenAnotherSegmentGrows: Story = {
  args: {
    sessions: factory_agentSessions(3),
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <GrowingSegment />
          <TerminalSessionChips {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
    const segment = within(toolbar).getByRole("group", { name: "Terminal sessions" });

    await waitFor(() => expect(within(segment).getAllByRole("button", { name: / terminal, / })).toHaveLength(3));
    await expect(within(segment).queryByRole("button", { name: /^All terminal sessions/ })).toBeNull();

    await userEvent.click(within(toolbar).getByRole("button", { name: "Grow" }));

    const overflowTrigger = await within(segment).findByRole("button", {
      name: /^All terminal sessions \(\d+ more\)$/,
    });
    const visibleChipCount: number = within(segment).getAllByRole("button", { name: / terminal, / }).length;

    await expect(visibleChipCount).toBeLessThan(3);
    await expect(overflowTrigger).toHaveAccessibleName(`All terminal sessions (${3 - visibleChipCount} more)`);
    await expect(segment.scrollWidth).toBeLessThanOrEqual(segment.clientWidth);
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
