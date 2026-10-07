import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "storybook/test";

import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { readContrastRatio } from "../../../../../../../../test-support/readContrastRatio";
import { LogAnsiFragment } from "../LogAnsiFragment";

const meta: Meta<typeof LogAnsiFragment> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/minimap/components/LogAnsiFragment",
  component: LogAnsiFragment,
  args: {
    fragment: {
      backgroundColor: null,
      foregroundColor: null,
      isBold: false,
      isDim: false,
      isItalic: false,
      isStrikethrough: false,
      isUnderline: false,
      text: "service log text",
    },
    isFocusedRow: false,
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <LogAnsiFragment {...args} />
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

/** Text without ANSI colors inherits the row's foreground. */
export const Plain: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const fragment = await canvas.findByText("service log text");

    await waitFor(() => {
      expect(readContrastRatio(fragment)).toBeGreaterThanOrEqual(4.5);
    });
  },
};

/** A foreground too close to its own ANSI background is adjusted until it reads; the background stays as sent. */
export const LowContrastPair: Story = {
  args: {
    fragment: {
      backgroundColor: "rgb(128, 128, 128)",
      foregroundColor: "rgb(128, 128, 128)",
      isBold: false,
      isDim: false,
      isItalic: false,
      isStrikethrough: false,
      isUnderline: false,
      text: "same-color pair",
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const fragment = await canvas.findByText("same-color pair");

    await waitFor(() => {
      expect(readContrastRatio(fragment)).toBeGreaterThanOrEqual(4.5);
    });
    await expect(getComputedStyle(fragment).backgroundColor).toBe("rgb(128, 128, 128)");
  },
};

/** Dimming applies to the text only, and stops where the text would become unreadable. */
export const Dimmed: Story = {
  args: {
    fragment: {
      backgroundColor: "rgb(0, 0, 0)",
      foregroundColor: "rgb(150, 150, 150)",
      isBold: false,
      isDim: true,
      isItalic: false,
      isStrikethrough: false,
      isUnderline: false,
      text: "dim text",
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const fragment = await canvas.findByText("dim text");

    await waitFor(() => {
      expect(readContrastRatio(fragment)).toBeGreaterThanOrEqual(4.5);
    });
    await expect(getComputedStyle(fragment).backgroundColor).toBe("rgb(0, 0, 0)");
  },
};

/** Underline and strikethrough combine instead of one replacing the other. */
export const UnderlinedAndStruck: Story = {
  args: {
    fragment: {
      backgroundColor: null,
      foregroundColor: null,
      isBold: true,
      isDim: false,
      isItalic: true,
      isStrikethrough: true,
      isUnderline: true,
      text: "decorated text",
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const fragment = await canvas.findByText("decorated text");
    const decorationLine: string = getComputedStyle(fragment).textDecorationLine;

    await expect(decorationLine.split(" ").sort()).toEqual(["line-through", "underline"]);
  },
};
