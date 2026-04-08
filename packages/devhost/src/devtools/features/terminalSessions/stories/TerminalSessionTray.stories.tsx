import type { CSSObject } from "@emotion/css/create-instance";
import type { Meta, StoryObj } from "@storybook/preact-vite";
import { render, type ComponentChildren, type JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { expect, waitFor, within } from "storybook/test";

import { configureDevtoolsCss, injectGlobal, ThemeProvider } from "../../../shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../../shared/constants";
import { TerminalSessionTray } from "../TerminalSessionTray";
import type { TerminalSession } from "../types";

interface IDevtoolsStoryShadowRootProps {
  children: ComponentChildren;
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
    eyebrow: "Annotation task",
    headline: "Fix button",
    meta: ["0 markers"],
    terminalTitle: "Agent terminal",
    trayTooltipPrimary: "Fix button",
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
  component: TerminalSessionTray,
  render: (args) => {
    return renderInDevtoolsStoryShadowRoot(
      <ThemeProvider colorScheme="dark">
        <TerminalSessionTray {...args} />
      </ThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    onExpandSession: (): void => {},
    onMinimizeSession: (): void => {},
    onRemoveSession: (): void => {},
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

export { Default as TerminalSessionTray };

function renderInDevtoolsStoryShadowRoot(children: ComponentChildren): JSX.Element {
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

  useLayoutEffect(() => {
    if (shadowMountNode === null) {
      return;
    }

    render(<>{props.children}</>, shadowMountNode);

    return () => {
      render(null, shadowMountNode);
    };
  }, [props.children, shadowMountNode]);

  return <div data-testid={devtoolsStoryShadowRootHostTestId} ref={hostElementReference} />;
}

function readShadowRoot(hostElement: HTMLElement, errorMessage: string): ShadowRoot {
  const shadowRoot: ShadowRoot | null = hostElement.shadowRoot;

  if (shadowRoot === null) {
    throw new Error(errorMessage);
  }

  return shadowRoot;
}
