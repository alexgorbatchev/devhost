import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";

import { Kbd, KbdGroup } from "../Kbd";
import {
  readDevtoolsStoryShadowCanvas,
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

export const OnDefaultButton: Story = {
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <Button shortcut="Alt+Ctrl+R">Restart Changed</Button>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Restart Changed" });
    const shortcut = shadowCanvas.getByText("Alt+Ctrl+R");
    await expect(readContrastRatio(shortcut)).toBeLessThan(readContrastRatio(button));
    await expect(readContrastRatio(shortcut)).toBeGreaterThanOrEqual(4.5);
  },
};

export const LightOnDefaultButton: Story = {
  ...OnDefaultButton,
  globals: { devhostTheme: "light" },
  play: OnDefaultButton.play,
};

export const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("Cmd")).toBeInTheDocument();
    await expect(shadowCanvas.getByText("Enter")).toBeInTheDocument();
  },
};

export const LightOnPrimary: Story = {
  globals: { devhostTheme: "light" },
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <Button variant="primary" shortcut="⌘↵">
          Claude Code
        </Button>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const shortcut = shadowCanvas.getByText("⌘↵");
    const button = shadowCanvas.getByRole("button", { name: "Claude Code" });
    await expect(readContrastRatio(shortcut)).toBeGreaterThanOrEqual(4.5);
    await expect(readContrastRatio(shortcut)).toBeLessThan(readContrastRatio(button));
  },
};

export const DarkOnPrimary: Story = {
  ...LightOnPrimary,
  globals: { devhostTheme: "dark" },
  play: LightOnPrimary.play,
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
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(readContrastRatio(shadowCanvas.getByText("⌘K"))).toBeGreaterThanOrEqual(4.5);
  },
};
