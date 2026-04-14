import type { CSSObject } from "@emotion/css/create-instance";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, type JSX } from "react";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
import { expect, waitFor, within, fn } from "storybook/test";

import { configureDevtoolsCss, injectGlobal, ThemeProvider } from "../../../shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../../shared/constants";
import { TerminalSessionTray } from "../TerminalSessionTray";
import type { TerminalSession } from "../types";
import { StoryContainer } from "../../../shared/stories/StoryContainer";

interface IDevtoolsStoryShadowRootProps {
  children: ReactNode;
}

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

const devtoolsStoryShadowRootGlobalStyles: CSSObject = {
  ":host": {
    color: "initial",
  },
  "*, *::before, *::after": {
    boxSizing: "border-box",
  },
  button: {
    font: "inherit",
  },
  input: {
    font: "inherit",
  },
  textarea: {
    font: "inherit",
  },
};
const devtoolsStoryShadowRootHostTestId: string = "DevtoolsStoryShadowRoot";

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
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
    const shadowRoot: ShadowRoot = readShadowRoot(
      shadowHost,
      "Expected the terminal tray story to attach a shadow root.",
    );

    await waitFor(async (): Promise<void> => {
      await expect(shadowRoot.querySelector('[data-testid="TerminalSessionTray"]')).not.toBeNull();
    });
  },
};

export const WithExpandedSession: Story = {
  args: {
    onExpandSession: fn(),
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    sessions: [
      {
        ...agentSession,
        isExpanded: true,
      },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
    const shadowRoot: ShadowRoot = readShadowRoot(
      shadowHost,
      "Expected the terminal tray story to attach a shadow root.",
    );

    await waitFor(async (): Promise<void> => {
      await expect(shadowRoot.querySelector('[data-testid="TerminalSessionTray--expanded-root"]')).not.toBeNull();
    });
  },
};

export const MultipleMinimizedSessions: Story = {
  args: {
    onExpandSession: fn(),
    onMinimizeSession: fn(),
    onRemoveSession: fn(),
    sessions: [
      agentSession,
      {
        ...agentSession,
        sessionId: "session-2",
        summary: {
          ...agentSession.summary,
          headline: "Second agent session",
        },
      },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
    const shadowRoot: ShadowRoot = readShadowRoot(
      shadowHost,
      "Expected the terminal tray story to attach a shadow root.",
    );

    await waitFor(async (): Promise<void> => {
      await expect(shadowRoot.querySelector('[data-testid="TerminalSessionTray--session-list"]')).not.toBeNull();
    });
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
    const canvas = within(canvasElement);
    const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
    const shadowRoot: ShadowRoot = readShadowRoot(
      shadowHost,
      "Expected the terminal tray story to attach a shadow root.",
    );

    await waitFor(async (): Promise<void> => {
      await expect(shadowRoot.querySelector('[data-testid="TerminalSessionTray"]')).toBeNull();
    });
  },
};

function renderInDevtoolsStoryShadowRoot(children: ReactNode): JSX.Element {
  return <DevtoolsStoryShadowRoot>{children}</DevtoolsStoryShadowRoot>;
}

function DevtoolsStoryShadowRoot(props: IDevtoolsStoryShadowRootProps): JSX.Element {
  const hostElementReference = useRef<HTMLDivElement | null>(null);
  const [shadowMountNode, setShadowMountNode] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const hostElement: HTMLDivElement | null = hostElementReference.current;

    if (hostElement === null) {
      return;
    }

    const shadowRoot: ShadowRoot = hostElement.shadowRoot ?? hostElement.attachShadow({ mode: "open" });
    const mountNode: HTMLDivElement = document.createElement("div");

    mountNode.setAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME, "");
    shadowRoot.append(mountNode);

    configureDevtoolsCss(shadowRoot);
    injectGlobal(devtoolsStoryShadowRootGlobalStyles);
    setShadowMountNode(mountNode);

    return () => {
      setShadowMountNode(null);
      mountNode.remove();
    };
  }, []);

  return (
    <div data-testid={devtoolsStoryShadowRootHostTestId} ref={hostElementReference}>
      {shadowMountNode ? createPortal(props.children, shadowMountNode) : null}
    </div>
  );
}

function readShadowRoot(hostElement: HTMLElement, errorMessage: string): ShadowRoot {
  const shadowRoot: ShadowRoot | null = hostElement.shadowRoot;

  if (shadowRoot === null) {
    throw new Error(errorMessage);
  }

  return shadowRoot;
}
