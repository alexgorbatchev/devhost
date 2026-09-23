import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, waitFor } from "storybook/test";

import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { TerminalSessionHost } from "../TerminalSessionHost";
import { fixture_agentSession, fixture_commandSession, fixture_fullscreenAgentSession } from "./fixtures";

const meta: Meta<typeof TerminalSessionHost> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/terminalSessions/components/TerminalSessionHost",
  component: TerminalSessionHost,
  args: {
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    isMinimapVisible: false,
    onSessionStatusChange: fn(),
    sessions: [fixture_commandSession, fixture_agentSession],
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <TerminalSessionHost {...args} />
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

export const OneExpandedSession: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await waitFor(async () => {
      await expect(await shadowCanvas.findByRole("dialog", { name: "Create Ticket terminal" })).toBeVisible();
    });
    await expect(shadowCanvas.getAllByRole("dialog")).toHaveLength(1);
    await waitFor(() => {
      expect(args.onSessionStatusChange).toHaveBeenCalledWith("command-session-1", "running", null);
      expect(args.onSessionStatusChange).toHaveBeenCalledWith("session-1", "running", null);
    });
  },
};

const expandedFullscreenSession = { ...fixture_fullscreenAgentSession, isExpanded: true };

export const FullscreenBesideMinimap: Story = {
  args: {
    isMinimapVisible: true,
    sessions: [expandedFullscreenSession],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog: HTMLElement = await shadowCanvas.findByRole("dialog");
    const minimapWidth: number = Number.parseFloat(
      getComputedStyle(dialog).getPropertyValue("--devhost-minimap-collapsed-width"),
    );

    // The minimap stays docked on the right edge, so a fullscreen terminal must stop where the collapsed minimap begins.
    await expect(minimapWidth).toBeGreaterThan(0);
    await waitFor(() => {
      expect(window.innerWidth - dialog.getBoundingClientRect().right).toBe(minimapWidth);
    });
    await expect(dialog.getBoundingClientRect().left).toBe(0);
  },
};

export const FullscreenWithoutMinimap: Story = {
  args: {
    sessions: [expandedFullscreenSession],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog: HTMLElement = await shadowCanvas.findByRole("dialog");

    await waitFor(() => {
      expect(dialog.getBoundingClientRect().right).toBe(window.innerWidth);
    });
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.queryByTestId("TerminalSessionHost")).toBeNull();
  },
};
