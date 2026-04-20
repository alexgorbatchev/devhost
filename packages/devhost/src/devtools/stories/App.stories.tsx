import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "storybook/test";
import { useEffect } from "react";

import { App } from "../App";
import { renderDevtools } from "../renderDevtools";
import { DEVTOOLS_HOST_ID } from "../shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../shared/constants";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../shared/stories/DevtoolsStoryShadowRoot";
import { StoryContainer } from "../shared/stories/StoryContainer";
import { withDevhostMock } from "./withDevhostMock";

const meta: Meta<typeof App> = {
  title: "@alexgorbatchev/devhost/devtools/App",
  component: App,
  decorators: [withDevhostMock],
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  render: () =>
    renderInDevtoolsStoryShadowRoot(
      <StoryContainer>
        <App />
      </StoryContainer>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowRoot = await readStoryShadowRoot(canvasElement);

    expect(shadowRoot.querySelector("[data-testid='AppContent']")).not.toBeNull();

    await waitFor(() => {
      expect(shadowRoot.querySelector("[data-testid='ServiceStatusPanel']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='LogMinimap']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='AnnotationComposer']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='AnnotationQueuePanel']")).not.toBeNull();
      expect(shadowRoot.querySelector("[data-testid='TerminalSessionTray']")).not.toBeNull();
    });

    expect(shadowRoot.querySelector("[data-testid='ServiceStatusPanel--service-list']")).not.toBeNull();
    expect(shadowRoot.querySelector("[data-testid='LogMinimap--canvas']")).not.toBeNull();
    expect(shadowRoot.querySelector("[data-testid='AnnotationQueuePanel--queue-list']")).not.toBeNull();
    expect(shadowRoot.querySelector("[data-testid='TerminalSessionTray--session-list']")).not.toBeNull();
    expect(shadowRoot.querySelector("[data-testid='TerminalSessionPanel--expand']")).not.toBeNull();
  },
};

const InjectedMount: Story = {
  render: () => <InjectedMountStory />,
  play: async (): Promise<void> => {
    await waitFor(() => {
      const hostElement = document.getElementById(DEVTOOLS_HOST_ID);
      expect(hostElement).not.toBeNull();
      expect(hostElement?.getAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME)).toBe("");
      expect(hostElement?.shadowRoot).not.toBeNull();
      expect(hostElement?.shadowRoot?.querySelector("[data-testid='AppContent']")).not.toBeNull();
    });
  },
};

function InjectedMountStory(): null {
  useEffect(() => {
    renderDevtools();

    return () => {
      document.getElementById(DEVTOOLS_HOST_ID)?.remove();
    };
  }, []);

  return null;
}

async function readStoryShadowRoot(canvasElement: HTMLElement): Promise<ShadowRoot> {
  const canvas = within(canvasElement);
  const shadowHost: HTMLElement = await canvas.findByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(shadowHost, "Expected the App story to attach a shadow root.");

  await expect(shadowHost.shadowRoot).toBe(shadowRoot);

  return shadowRoot;
}

export { Default as App, InjectedMount };
