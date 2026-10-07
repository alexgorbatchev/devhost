import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { useState, type ComponentProps, type JSX } from "react";

import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { TerminalSessionPanel } from "../TerminalSessionPanel";
import type { TerminalSession, TerminalSessionStatus } from "../../types";
import {
  fixture_agentSession,
  fixture_agentSessionSnapshot,
  fixture_contrastSession,
  fixture_commandSession,
  fixture_editorSession,
  fixture_finishedAgentSession,
  fixture_fullscreenAgentSession,
} from "./fixtures";
import { readContrastRatio } from "../../../../../../../../test-support/readContrastRatio";
import {
  installTerminalSessionMock,
  type ITerminalSessionMock,
} from "../../../../../../.storybook/installTerminalSessionMock";
import type { IMockWebSocketConnection } from "../../../../../../test-support/createMockWebSocket";

const meta: Meta<typeof TerminalSessionPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/terminalSessions/components/TerminalSessionPanel",
  component: TerminalSessionPanel,
  args: {
    isExpanded: true,
    isMinimapVisible: false,
    onMinimize: fn(),
    onRemove: fn(),
    onStatusChange: fn(),
    session: fixture_agentSession,
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <TerminalSessionPanelHarness {...args} />
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

type TerminalSessionPanelProps = ComponentProps<typeof TerminalSessionPanel>;

// The devhost a connection-loss story plays. Its `beforeEach` installs it before the panel renders.
let terminalSessionMock: ITerminalSessionMock;

function installAgentSessionMock(): ITerminalSessionMock["uninstall"] {
  terminalSessionMock = installTerminalSessionMock(fixture_agentSessionSnapshot, "before the drop\r\n");

  return terminalSessionMock.uninstall;
}

function readTerminalConnection(index: number): IMockWebSocketConnection {
  const connection: IMockWebSocketConnection | undefined = terminalSessionMock.connections[index];

  if (connection === undefined) {
    throw new Error(`The panel has not opened terminal connection ${index + 1}.`);
  }

  return connection;
}

// Applies reported status back onto the session, as useTerminalSessions does in the app.
function TerminalSessionPanelHarness(props: TerminalSessionPanelProps): JSX.Element {
  const [session, setSession] = useState<TerminalSession>(() => props.session);

  return (
    <TerminalSessionPanel
      {...props}
      session={session}
      onStatusChange={(status: TerminalSessionStatus, errorMessage: string | null): void => {
        props.onStatusChange(status, errorMessage);
        setSession((currentSession: TerminalSession): TerminalSession => {
          return { ...currentSession, errorMessage, status };
        });
      }}
    />
  );
}

export const Expanded: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });

    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("0 initial markers · Cart — Acme Shop · shop.example.test");
    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--backdrop")).toBeVisible();
    await waitFor(() => expect(args.onStatusChange).toHaveBeenCalledWith("running", null));

    const minimizeButton = shadowCanvas.getByRole("button", { name: "Minimize" });
    await expect(within(minimizeButton).getByText("Minimize")).toBeVisible();
    await userEvent.click(minimizeButton);
    await expect(args.onMinimize).toHaveBeenCalledTimes(1);

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Terminate" }));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

export const FullscreenExpanded: Story = {
  args: {
    session: fixture_fullscreenAgentSession,
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });

    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog.getBoundingClientRect().width).toBe(window.innerWidth);
    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--backdrop")).not.toBeVisible();

    const minimizeButton = shadowCanvas.getByRole("button", { name: "Minimize" });
    await expect(within(minimizeButton).getByText("Minimize")).toBeVisible();
    await userEvent.click(minimizeButton);
    await expect(args.onMinimize).toHaveBeenCalledTimes(1);
  },
};

// Minimized sessions stay mounted and connected so their toolbar chip keeps reporting live status.
export const Minimized: Story = {
  args: {
    isExpanded: false,
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await waitFor(() => expect(args.onStatusChange).toHaveBeenCalledWith("running", null));
    await expect(shadowCanvas.queryByRole("dialog", { name: "Pi terminal" })).toBeNull();
  },
};

export const EditorExpanded: Story = {
  args: {
    session: fixture_editorSession,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Neovim terminal" });

    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("<PrimaryButton> · src/components/PrimaryButton.tsx:12:3");
  },
};

export const CommandExpanded: Story = {
  args: {
    session: fixture_commandSession,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await waitFor(async () => {
      await expect(await shadowCanvas.findByRole("dialog", { name: "Create Ticket terminal" })).toBeVisible();
    });
  },
};

export const Finished: Story = {
  args: {
    session: fixture_finishedAgentSession,
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await waitFor(() => expect(args.onStatusChange).toHaveBeenCalledWith("exited", null));

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Close" }));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

/** The panel reattaches to its session when the connection drops, as it does after the machine sleeps. */
export const ReattachesAfterConnectionLoss: Story = {
  beforeEach: installAgentSessionMock,
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });
    const terminal = within(dialog).getByTestId("TerminalSessionPanel--terminal");

    await waitFor(() => expect(dialog).toBeVisible());
    await within(terminal).findByText("before the drop");
    await expect(within(dialog).getByText("running")).toBeVisible();

    terminalSessionMock.output = "after the drop\r\n";
    readTerminalConnection(0).close(1006);
    await expect(await within(dialog).findByText("disconnected")).toBeVisible();

    // The session's output arrives again, so the terminal shows it once instead of appending it.
    await within(terminal).findByText("after the drop");
    await expect(within(terminal).queryByText("before the drop")).toBeNull();
    await expect(within(dialog).getByText("running")).toBeVisible();
    await expect(terminalSessionMock.connections).toHaveLength(2);

    // The reattached session learns the terminal's size, and keys reach it.
    await userEvent.keyboard("ls");
    await waitFor(() => {
      const sentFrames: string[] = readTerminalConnection(1).readSentFrames().map(String);

      expect(sentFrames.filter((frame: string): boolean => frame.includes('"type":"resize"'))).not.toEqual([]);
      expect(sentFrames.filter((frame: string): boolean => frame.includes('"type":"input"'))).toEqual([
        '{"data":"l","type":"input"}',
        '{"data":"s","type":"input"}',
      ]);
    });
  },
};

/** Devhost no longer runs the session, as after it restarted. The panel says so and keeps the output it has. */
export const SessionEndedWhileDisconnected: Story = {
  beforeEach: installAgentSessionMock,
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });
    const terminal = within(dialog).getByTestId("TerminalSessionPanel--terminal");

    await waitFor(() => expect(dialog).toBeVisible());
    await within(terminal).findByText("before the drop");

    terminalSessionMock.hasEnded = true;
    readTerminalConnection(0).close(1006);

    await expect(await within(dialog).findByText("This terminal session is no longer running.")).toBeVisible();
    await expect(within(dialog).getByText("error")).toBeVisible();
    await expect(within(terminal).getByText("before the drop")).toBeVisible();
    await expect(terminalSessionMock.attemptCount).toBe(1);
  },
};

/**
 * A finished agent session whose retained output still carries the status the agent last reported. The session
 * stays finished: what an agent reported while it ran does not bring it back.
 */
export const FinishedAfterReportingWork: Story = {
  beforeEach: (): ITerminalSessionMock["uninstall"] => {
    terminalSessionMock = installTerminalSessionMock(
      fixture_agentSessionSnapshot,
      "\u001b]1337;SetAgentStatus=working\u0007reviewed the change\r\n",
    );
    terminalSessionMock.hasExited = true;

    return terminalSessionMock.uninstall;
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });
    const terminal = within(dialog).getByTestId("TerminalSessionPanel--terminal");

    await waitFor(() => expect(dialog).toBeVisible());
    // The terminal has read the retained output by now, the agent's status report included.
    await within(terminal).findByText("reviewed the change");

    await expect(within(dialog).getByText("finished")).toBeVisible();
    await expect(within(dialog).queryByText("working")).toBeNull();
    await expect(within(dialog).getByRole("button", { name: "Close" })).toBeVisible();
  },
};

export const ContrastDark: Story = {
  globals: { devhostTheme: "dark" },
  args: { session: fixture_contrastSession },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await waitFor(() => {
      const blackText = shadowCanvas.getByText("X");
      expect(blackText).toBeVisible();
      expect(readContrastRatio(blackText)).toBeGreaterThanOrEqual(4.5);
    });
  },
};

export const ContrastLight: Story = {
  globals: { devhostTheme: "light" },
  args: { session: fixture_contrastSession },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    for (const character of ["G", "Y", "C", "W"]) {
      await waitFor(() => {
        const text = shadowCanvas.getByText(character);
        expect(text).toBeVisible();
        expect(readContrastRatio(text)).toBeGreaterThanOrEqual(4.5);
      });
    }
  },
};
