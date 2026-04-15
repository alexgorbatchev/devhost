import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../shared/stories/DevtoolsStoryShadowRoot";
import { TerminalSessionTray } from "../TerminalSessionTray";
import type { TerminalSession } from "../types";
import { StoryContainer } from "../../../shared/stories/StoryContainer";

const agentSession: TerminalSession = {
  annotation: {
    comment: "Fix button",
    markers: [],
    stackName: "story-stack",
    submittedAt: 1,
    title: "Story",
    url: "https://example.test",
  },
  behavior: {
    defaultIsExpanded: false,
    isFullscreenExpanded: true,
    shouldAutoRemoveOnExit: false,
  },
  displayName: "Pi",
  isExpanded: false,
  kind: "agent",
  sessionId: "session-1",
  summary: {
    eyebrow: "Pi",
    headline: "Agent session",
    meta: ["0 initial markers"],
    terminalTitle: "Agent terminal",
    trayTooltipPrimary: "Agent session",
    trayTooltipSecondary: "Pi",
  },
};

const expandedAgentSession: TerminalSession = {
  ...agentSession,
  behavior: {
    ...agentSession.behavior,
    isFullscreenExpanded: false,
  },
  isExpanded: true,
};

const secondAgentSession: TerminalSession = {
  ...agentSession,
  sessionId: "session-2",
  summary: {
    ...agentSession.summary,
    headline: "Second agent session",
    terminalTitle: "Second agent terminal",
    trayTooltipPrimary: "Second agent session",
    trayTooltipSecondary: "Pi 2",
  },
};

const meta: Meta<typeof TerminalSessionTray> = {
  title: "@alexgorbatchev/devhost/devtools/features/terminalSessions/TerminalSessionTray",
  component: TerminalSessionTray,
  render: (args) => {
    return renderInDevtoolsStoryShadowRoot(
      <ThemeProvider colorScheme="dark">
        <StoryContainer align="center">
          <TerminalSessionTray {...args} />
        </StoryContainer>
      </ThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onExpandSession: fn(),
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    sessions: [agentSession],
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await shadowCanvas.findByTestId("TerminalSessionTray");
    await userEvent.click(shadowCanvas.getByTestId("TerminalSessionPanel--expand"));
    await expect(args.onExpandSession).toHaveBeenCalledWith("session-1");
  },
};

export const WithExpandedSession: Story = {
  args: {
    onExpandSession: fn(),
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    sessions: [expandedAgentSession],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await shadowCanvas.findByTestId("TerminalSessionTray");
    await expect(shadowCanvas.getByTestId("TerminalSessionTray--expanded-root")).toBeInTheDocument();
    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--content")).toBeInTheDocument();
  },
};

export const MultipleMinimizedSessions: Story = {
  args: {
    onExpandSession: fn(),
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    sessions: [agentSession, secondAgentSession],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await shadowCanvas.findByTestId("TerminalSessionTray");
    await expect(shadowCanvas.getByTestId("TerminalSessionTray--session-list")).toBeInTheDocument();
    await expect(shadowCanvas.getAllByTestId("TerminalSessionPanel--expand")).toHaveLength(2);
  },
};

export const MixedSessions: Story = {
  args: {
    onExpandSession: fn(),
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    sessions: [expandedAgentSession, secondAgentSession],
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await shadowCanvas.findByTestId("TerminalSessionTray");
    await expect(shadowCanvas.getByTestId("TerminalSessionTray--expanded-root")).toBeInTheDocument();
    await expect(shadowCanvas.getByTestId("TerminalSessionTray--session-list")).toBeInTheDocument();

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Minimize" }));
    await expect(args.onMinimizeSession).toHaveBeenCalledWith("session-1");

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Terminate" }));
    await expect(args.onRemoveSession).toHaveBeenCalledWith("session-1");

    const expandButtons = shadowCanvas.getAllByTestId("TerminalSessionPanel--expand");
    await userEvent.click(expandButtons[0]!);
    await expect(args.onExpandSession).toHaveBeenCalledWith("session-2");
  },
};

export const Empty: Story = {
  args: {
    onExpandSession: fn(),
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    sessions: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.queryByTestId("TerminalSessionTray")).not.toBeInTheDocument();
  },
};

async function readStoryShadowCanvas(canvasElement: HTMLElement): Promise<ReturnType<typeof within>> {
  const canvas = within(canvasElement);
  const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(
    shadowHost,
    "Expected the terminal tray story to attach a shadow root.",
  );

  return within(shadowRoot as unknown as HTMLElement);
}
