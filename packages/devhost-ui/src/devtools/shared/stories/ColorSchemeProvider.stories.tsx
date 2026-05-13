import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { ColorSchemeProvider, type DevtoolsColorScheme, useDevtoolsColorScheme } from "..";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "./DevtoolsStoryShadowRoot";

function ColorSchemeConsumer() {
  const colorScheme = useDevtoolsColorScheme();

  return (
    <div
      className="rounded-md border border-border bg-background p-3 text-foreground"
      data-testid="color-scheme-consumer"
    >
      Color scheme: {colorScheme}
    </div>
  );
}

const meta: Meta<typeof ColorSchemeProvider> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/ColorSchemeProvider",
  component: ColorSchemeProvider,
  render: (args) => {
    return renderInDevtoolsStoryShadowRoot(
      <ColorSchemeProvider {...args}>
        <ColorSchemeConsumer />
      </ColorSchemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Dark: Story = {
  args: {
    colorScheme: "dark",
  },
  play: async ({ canvasElement }): Promise<void> => {
    await expectColorSchemeStory(canvasElement, "dark");
  },
};

export const Light: Story = {
  args: {
    colorScheme: "light",
  },
  play: async ({ canvasElement }): Promise<void> => {
    await expectColorSchemeStory(canvasElement, "light");
  },
};

async function expectColorSchemeStory(canvasElement: HTMLElement, colorScheme: DevtoolsColorScheme): Promise<void> {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "ColorSchemeProvider story shadow root was not created.");
  const shadowCanvas = within(shadowRoot as unknown as HTMLElement);

  await expect(shadowCanvas.getByTestId("color-scheme-consumer")).toHaveTextContent(`Color scheme: ${colorScheme}`);
  await expect(hostElement).toHaveAttribute("data-theme", colorScheme);
}
