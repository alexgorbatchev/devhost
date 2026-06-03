import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { Kbd, KbdGroup } from "../Kbd";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";

const meta: Meta<typeof Kbd> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/Kbd",
  component: Kbd,
  render: (_args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <KbdGroup>
          <Kbd>Cmd</Kbd>
          <Kbd>Enter</Kbd>
        </KbdGroup>
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readKbdShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("Cmd")).toBeInTheDocument();
    await expect(shadowCanvas.getByText("Enter")).toBeInTheDocument();
  },
};

export { Default as Kbd };

function readKbdShadowCanvas(canvasElement: HTMLElement): ReturnType<typeof within> {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "Kbd story shadow root was not created.");

  return within(shadowRoot as unknown as HTMLElement);
}
