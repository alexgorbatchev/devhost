import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "storybook/test";
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
  fixture_commandSession,
  fixture_editorSession,
  fixture_finishedAgentSession,
  fixture_fullscreenAgentSession,
} from "./fixtures";

const meta: Meta<typeof TerminalSessionPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/terminalSessions/components/TerminalSessionPanel",
  component: TerminalSessionPanel,
  args: {
    isExpanded: true,
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

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Minimize" }));
    await expect(args.onMinimize).toHaveBeenCalledTimes(1);

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Terminate" }));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

export const FullscreenExpanded: Story = {
  args: {
    session: fixture_fullscreenAgentSession,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });

    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog.getBoundingClientRect().width).toBe(window.innerWidth);
    await expect(shadowCanvas.getByTestId("TerminalSessionPanel--backdrop")).not.toBeVisible();
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
