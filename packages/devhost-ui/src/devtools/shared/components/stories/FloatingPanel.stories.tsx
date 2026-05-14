import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { FloatingPanel } from "../FloatingPanel";
import { devtoolsStoryShadowRootHostTestId, readShadowRoot, renderInDevtoolsStoryShadowRoot } from "./helpers";
import { StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof FloatingPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/FloatingPanel",
  component: FloatingPanel,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <FloatingPanel {...args}>Panel content</FloatingPanel>
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    position: "absolute",
    testId: "floating-panel",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readFloatingPanelShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByTestId("floating-panel")).toHaveTextContent("Panel content");
  },
};

export { Default as FloatingPanel };

function readFloatingPanelShadowCanvas(canvasElement: HTMLElement): ReturnType<typeof within> {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "FloatingPanel story shadow root was not created.");

  return within(shadowRoot as unknown as HTMLElement);
}
