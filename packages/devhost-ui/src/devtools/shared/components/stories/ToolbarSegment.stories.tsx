import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { Button } from "../../../../components/ui/Button";
import { ToolbarSegment } from "../ToolbarSegment";
import { readDevtoolsStoryShadowCanvas, renderInDevtoolsStoryShadowRoot, StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof ToolbarSegment> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/ToolbarSegment",
  component: ToolbarSegment,
  args: {
    ariaLabel: "External devtools",
  },
  // The toolbar row is narrower than the segment's three buttons.
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <div data-testid="ToolbarSegmentStory--row" style={{ display: "flex", width: 120 }}>
          <ToolbarSegment {...args}>
            <Button>Router</Button>
            <Button>Query</Button>
            <Button>Form</Button>
          </ToolbarSegment>
        </div>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

/** A fixed segment wraps its controls when the row is narrower than the group. */
export const Fixed: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const row = canvas.getByTestId("ToolbarSegmentStory--row");
    const segment = canvas.getByRole("group", { name: "External devtools" });

    await expect(segment.scrollWidth).toBe(segment.clientWidth);
    await expect(segment.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right);
    const buttons = within(segment).getAllByRole("button");
    for (const button of buttons) {
      await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(segment.getBoundingClientRect().right);
    }
    await expect(buttons[2]!.getBoundingClientRect().top).toBeGreaterThan(buttons[0]!.getBoundingClientRect().top);
  },
};

/** A shrinking segment gives up width and clips its content, so its owner can measure the overflow. */
export const Shrinking: Story = {
  args: {
    layout: "shrink",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const row = canvas.getByTestId("ToolbarSegmentStory--row");
    const segment = canvas.getByRole("group", { name: "External devtools" });

    await expect(segment.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right);
    await expect(segment.scrollWidth).toBeGreaterThan(segment.clientWidth);
  },
};
