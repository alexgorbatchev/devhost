import type { Meta, StoryObj } from "@storybook/react";
import { CheckIcon, RotateCwIcon } from "lucide-react";
import { expect } from "storybook/test";

import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { Icon } from "../Icon";

const meta: Meta<typeof Icon> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/Icon",
  component: Icon,
  args: {
    glyph: CheckIcon,
  },
  // The row is narrower than any icon, and the reference spans carry the tones an icon can take.
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <div style={{ display: "flex", width: 4 }}>
          <Icon {...args} />
        </div>
        <span className="text-success" data-testid="IconStory--success-reference" />
        <span className="text-destructive" data-testid="IconStory--destructive-reference" />
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

/** The default size, kept even when its row has no room for it. The icon takes the surrounding text color. */
export const Medium: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const icon = canvas.getByTestId("Icon");
    const row = icon.parentElement ?? icon;

    await expect(icon.getBoundingClientRect().width).toBe(14);
    await expect(icon.getBoundingClientRect().height).toBe(14);
    await expect(getComputedStyle(icon).color).toBe(getComputedStyle(row).color);
    await expect(icon.getAnimations()).toHaveLength(0);
  },
};

export const Small: Story = {
  args: {
    size: "sm",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const icon = canvas.getByTestId("Icon");

    await expect(icon.getBoundingClientRect().width).toBe(12);
    await expect(icon.getBoundingClientRect().height).toBe(12);
  },
};

export const SuccessTone: Story = {
  args: {
    tone: "success",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const icon = canvas.getByTestId("Icon");
    const reference = canvas.getByTestId("IconStory--success-reference");

    await expect(getComputedStyle(icon).color).toBe(getComputedStyle(reference).color);
  },
};

export const DestructiveTone: Story = {
  args: {
    tone: "destructive",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const icon = canvas.getByTestId("Icon");
    const reference = canvas.getByTestId("IconStory--destructive-reference");

    await expect(getComputedStyle(icon).color).toBe(getComputedStyle(reference).color);
  },
};

/** A spinning icon reports work in progress. */
export const Spinning: Story = {
  args: {
    glyph: RotateCwIcon,
    isSpinning: true,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const icon = canvas.getByTestId("Icon");

    await expect(icon.getAnimations()).toHaveLength(1);
  },
};
