import type { Meta, StoryObj } from "@storybook/react";
import { useState, type ComponentProps, type JSX } from "react";
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
import type { TerminalSession } from "../../types";
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

type TerminalSessionChipsProps = ComponentProps<typeof TerminalSessionChips>;

interface IResizableSegmentProps {
  /** The width of what the segment shows once it has grown. */
  wideWidth?: string;
}

/**
 * A neighbouring toolbar segment that takes more room and gives it back on request, as the services segment does
 * when a stack grows and shrinks.
 */
function ResizableSegment({ wideWidth = "calc(100vw - 320px)" }: IResizableSegmentProps): JSX.Element {
  const [isWide, setIsWide] = useState<boolean>(false);

  return (
    <ToolbarSegment ariaLabel="Services">
      <Button onClick={(): void => setIsWide((isCurrentlyWide: boolean): boolean => !isCurrentlyWide)}>
        {isWide ? "Shrink" : "Grow"}
      </Button>
      {isWide ? (
        <span style={{ flexShrink: 0, overflow: "hidden", whiteSpace: "nowrap", width: wideWidth }}>
          eight more services
        </span>
      ) : null}
    </ToolbarSegment>
  );
}

/**
 * Resolves once the browser has reported the size `element` has now to its resize observers. The chips observe
 * their own size too, so by then they have seen the change that led to it.
 */
function waitForResizeReport(element: Element): Promise<void> {
  const report = Promise.withResolvers<void>();
  const resizeObserver = new ResizeObserver((): void => {
    resizeObserver.disconnect();
    report.resolve();
  });

  resizeObserver.observe(element);

  return report.promise;
}

/** Chips whose first session finishes on request, as a session does when its process exits. */
function FinishingSessionChips(props: TerminalSessionChipsProps): JSX.Element {
  const [sessions, setSessions] = useState<TerminalSession[]>(() => props.sessions);

  return (
    <>
      <ToolbarSegment ariaLabel="Processes">
        <Button
          onClick={(): void => {
            setSessions((currentSessions: TerminalSession[]): TerminalSession[] => {
              return currentSessions.map((session: TerminalSession, index: number): TerminalSession => {
                return index === 1 ? { ...session, status: "exited" } : session;
              });
            });
          }}
        >
          Finish Agent 2
        </Button>
      </ToolbarSegment>
      <TerminalSessionChips {...props} sessions={sessions} />
    </>
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
          <ResizableSegment />
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

/**
 * A toolbar that is already as wide as it can be does not resize when a segment grows; only the chips' own segment
 * gets narrower. The chips fold then too.
 */
export const FoldsInAToolbarThatIsAlreadyFull: Story = {
  args: {
    sessions: factory_agentSessions(3),
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <div aria-label="devhost" role="toolbar" style={{ display: "flex", width: 480 }}>
          <ResizableSegment wideWidth="140px" />
          <TerminalSessionChips {...args} />
        </div>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
    const segment = within(toolbar).getByRole("group", { name: "Terminal sessions" });

    await waitFor(() => expect(within(segment).getAllByRole("button", { name: / terminal, / })).toHaveLength(3));

    const { height, width } = toolbar.getBoundingClientRect();

    await expect(width).toBe(480);
    // The chips fit once more after their first size is reported. Once that is behind them, only their own segment
    // getting narrower can make them fold.
    await waitForResizeReport(segment);
    await waitForResizeReport(segment);
    await userEvent.click(within(toolbar).getByRole("button", { name: "Grow" }));

    await expect(
      await within(segment).findByRole("button", { name: /^All terminal sessions \(\d+ more\)$/ }),
    ).toBeVisible();
    await expect(toolbar.getBoundingClientRect().width).toBe(width);
    await expect(toolbar.getBoundingClientRect().height).toBe(height);
    await expect(segment.scrollWidth).toBeLessThanOrEqual(segment.clientWidth);
  },
};

/** Folded chips come back when the neighbouring segment gives the room back. */
export const ExpandsWhenAnotherSegmentShrinks: Story = {
  args: {
    sessions: factory_agentSessions(3),
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <ResizableSegment />
          <TerminalSessionChips {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
    const segment = within(toolbar).getByRole("group", { name: "Terminal sessions" });

    await userEvent.click(within(toolbar).getByRole("button", { name: "Grow" }));
    await within(segment).findByRole("button", { name: /^All terminal sessions \(\d+ more\)$/ });
    // Folding resized the chips themselves. Once that is behind them, only the neighbour can bring the chips back.
    await waitForResizeReport(segment);
    await waitForResizeReport(segment);

    await userEvent.click(within(toolbar).getByRole("button", { name: "Shrink" }));

    await waitFor(() => expect(within(segment).getAllByRole("button", { name: / terminal, / })).toHaveLength(3));
    await expect(within(segment).queryByRole("button", { name: /^All terminal sessions/ })).toBeNull();
    await expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
  },
};

/** The list of all sessions stays open, and keeps keyboard focus where it is, while a session's state changes. */
export const KeepsTheSessionListOpenWhenASessionFinishes: Story = {
  args: {
    sessions: factory_agentSessions(16).map((session: TerminalSession): TerminalSession => {
      return { ...session, status: "running" };
    }),
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <FinishingSessionChips {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
    const overflowTrigger = await within(toolbar).findByRole("button", {
      name: /^All terminal sessions \(\d+ more\)$/,
    });

    await userEvent.click(overflowTrigger);

    const panel = await shadowCanvas.findByRole("region", { name: "Terminal sessions" });

    await waitFor(() => expect(panel).toBeVisible());

    // A click outside the list would close it, so the session is finished from the keyboard.
    within(toolbar).getByRole("button", { name: "Finish Agent 2" }).focus();
    await userEvent.keyboard("{Enter}");

    await expect(await within(panel).findByRole("button", { name: "Close Agent 2 session" })).toBeVisible();
    await expect(overflowTrigger).toBeInTheDocument();
    await expect(overflowTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
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
