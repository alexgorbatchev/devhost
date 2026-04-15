import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { ThemeProvider } from "../../../shared";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../shared/stories/DevtoolsStoryShadowRoot";
import { TerminalSessionPanel } from "../TerminalSessionPanel";
import type { TerminalSession } from "../types";

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

const editorSession: TerminalSession = {
  behavior: {
    defaultIsExpanded: true,
    isFullscreenExpanded: false,
    shouldAutoRemoveOnExit: true,
  },
  componentName: "PrimaryButton",
  isExpanded: true,
  kind: "editor",
  launcher: "neovim",
  sessionId: "editor-session-1",
  sourceLabel: "src/components/PrimaryButton.tsx:12",
  summary: {
    eyebrow: "Editor",
    headline: "PrimaryButton",
    meta: ["src/components/PrimaryButton.tsx:12"],
    terminalTitle: "Neovim",
    trayTooltipPrimary: "<PrimaryButton>",
    trayTooltipSecondary: "src/components/PrimaryButton.tsx:12",
  },
};

const finishedAgentSession: TerminalSession = {
  ...agentSession,
  sessionId: "session-finished",
};

const meta: Meta<typeof TerminalSessionPanel> = {
  title: "@alexgorbatchev/devhost/devtools/features/terminalSessions/TerminalSessionPanel",
  component: TerminalSessionPanel,
  render: (args) => {
    return renderInDevtoolsStoryShadowRoot(
      <ThemeProvider colorScheme="dark">
        <TerminalSessionPanel {...args} />
      </ThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Minimized: Story = {
  args: {
    isExpanded: false,
    onExpand: fn(),
    onMinimize: fn(),
    onRemove: fn(),
    session: agentSession,
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    const panel = shadowCanvas.getByTestId("TerminalSessionPanel");
    const expandButton = shadowCanvas.getByTestId("TerminalSessionPanel--expand");

    await userEvent.hover(panel);
    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--tooltip")).toHaveTextContent("Agent session");
    await expect(shadowCanvas.getByText("Pi")).toBeInTheDocument();

    await userEvent.click(expandButton);
    await expect(args.onExpand).toHaveBeenCalledTimes(1);
  },
};

export const Expanded: Story = {
  args: {
    isExpanded: true,
    onExpand: fn(),
    onMinimize: fn(),
    onRemove: fn(),
    session: {
      ...agentSession,
      behavior: {
        ...agentSession.behavior,
        isFullscreenExpanded: false,
      },
    },
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--content")).toBeInTheDocument();
    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--summary")).toHaveTextContent("Agent session");

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Minimize" }));
    await expect(args.onMinimize).toHaveBeenCalledTimes(1);

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Terminate" }));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

export const FullscreenExpanded: Story = {
  args: {
    isExpanded: true,
    onExpand: fn(),
    onMinimize: fn(),
    onRemove: fn(),
    session: {
      ...agentSession,
      behavior: {
        ...agentSession.behavior,
        isFullscreenExpanded: true,
      },
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--backdrop")).toBeInTheDocument();
    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--content")).toBeInTheDocument();
    await expect(shadowCanvas.getByText("Agent terminal")).toBeInTheDocument();
  },
};

export const EditorExpanded: Story = {
  args: {
    isExpanded: true,
    onExpand: fn(),
    onMinimize: fn(),
    onRemove: fn(),
    session: editorSession,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("Neovim")).toBeInTheDocument();
    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--summary")).toHaveTextContent("PrimaryButton");
    await expect(shadowCanvas.getByText("src/components/PrimaryButton.tsx:12")).toBeInTheDocument();
  },
};

export const FinishedMinimized: Story = {
  args: {
    isExpanded: false,
    onExpand: fn(),
    onMinimize: fn(),
    onRemove: fn(),
    session: finishedAgentSession,
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readStoryShadowCanvas(canvasElement);

    await expect(await shadowCanvas.findByTestId("TerminalSessionPanel--completion-indicator")).toBeInTheDocument();

    await userEvent.hover(shadowCanvas.getByTestId("TerminalSessionPanel"));
    await userEvent.click(await shadowCanvas.findByTestId("TerminalSessionPanel--tray-close"));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

async function readStoryShadowCanvas(canvasElement: HTMLElement): Promise<ReturnType<typeof within>> {
  const canvas = within(canvasElement);
  const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(
    shadowHost,
    "Expected the terminal panel story to attach a shadow root.",
  );
  const typedShadowCanvas = within(shadowRoot as unknown as HTMLElement);

  await typedShadowCanvas.findByTestId("TerminalSessionPanel");

  return typedShadowCanvas;
}
