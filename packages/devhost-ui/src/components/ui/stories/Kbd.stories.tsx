import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { Kbd, KbdGroup } from "../Kbd";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";
import { Button } from "../Button";
import { readContrastRatio } from "../../../../../../test-support/readContrastRatio";

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

export const LightOnPrimary: Story = {
  globals: { devhostTheme: "light" },
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <Button variant="primary" endEnhancer={<Kbd>⌘↵</Kbd>}>
          Claude Code
        </Button>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readKbdShadowCanvas(canvasElement);
    await expect(readContrastRatio(shadowCanvas.getByText("⌘↵"))).toBeGreaterThanOrEqual(4.5);
  },
};

export const LightOnSecondary: Story = {
  globals: { devhostTheme: "light" },
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <div className="bg-secondary text-muted-foreground">
          <Kbd>⌘K</Kbd>
        </div>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readKbdShadowCanvas(canvasElement);
    await expect(readContrastRatio(shadowCanvas.getByText("⌘K"))).toBeGreaterThanOrEqual(4.5);
  },
};

function readKbdShadowCanvas(canvasElement: HTMLElement): ReturnType<typeof within> {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "Kbd story shadow root was not created.");

  return within(shadowRoot as unknown as HTMLElement);
}
