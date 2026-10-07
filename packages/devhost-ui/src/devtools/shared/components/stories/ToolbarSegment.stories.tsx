import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";

import { Button } from "../../../../components/ui/Button";
import { ToolbarSegment } from "../ToolbarSegment";
import { readDevtoolsStoryShadowCanvas, renderInDevtoolsStoryShadowRoot, StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof ToolbarSegment> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/ToolbarSegment",
  component: ToolbarSegment,
  args: {
    ariaLabel: "Terminal sessions",
  },
  // The toolbar row is narrower than the segment's three buttons.
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <div data-testid="ToolbarSegmentStory--row" style={{ display: "flex", width: 120 }}>
          <ToolbarSegment {...args}>
            <Button>Agent one</Button>
            <Button>Agent two</Button>
            <Button>Agent three</Button>
          </ToolbarSegment>
        </div>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

/** A fixed segment keeps its content width, even when the row is too narrow for it. */
export const Fixed: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const row = canvas.getByTestId("ToolbarSegmentStory--row");
    const segment = canvas.getByRole("group", { name: "Terminal sessions" });

    await expect(segment.scrollWidth).toBe(segment.clientWidth);
    await expect(segment.getBoundingClientRect().right).toBeGreaterThan(row.getBoundingClientRect().right);
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
    const segment = canvas.getByRole("group", { name: "Terminal sessions" });

    await expect(segment.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right);
    await expect(segment.scrollWidth).toBeGreaterThan(segment.clientWidth);
  },
};
