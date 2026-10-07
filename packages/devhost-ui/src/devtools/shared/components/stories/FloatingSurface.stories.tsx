import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "storybook/test";

import { Card, CardContent } from "../../../../components/ui/Card";
import { FloatingSurface } from "../FloatingSurface";
import { readDevtoolsStoryShadowCanvas, renderInDevtoolsStoryShadowRoot, StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof FloatingSurface> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/FloatingSurface",
  component: FloatingSurface,
  args: {
    "aria-label": "Example surface",
    isOpen: true,
    left: 40,
    role: "dialog",
    top: 60,
    width: "sm",
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <FloatingSurface {...args}>
          <Card>
            <CardContent>Surface content</CardContent>
          </Card>
        </FloatingSurface>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

/** An open surface sits at the viewport coordinates it was given. */
export const Open: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const surface = await canvas.findByRole("dialog", { name: "Example surface" });

    await waitFor(() => {
      expect(surface).toBeVisible();
    });
    await expect(surface.getBoundingClientRect().left).toBe(40);
    await expect(surface.getBoundingClientRect().top).toBe(60);
  },
};

export const Wide: Story = {
  args: {
    width: "md",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const surface = await canvas.findByRole("dialog", { name: "Example surface" });
    const narrowWidth: number = 320;

    await expect(surface.getBoundingClientRect().width).toBeGreaterThan(narrowWidth);
  },
};

/** A closed surface stays mounted, but neither the pointer nor assistive technology can reach it. */
export const Closed: Story = {
  args: {
    isOpen: false,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const surface = await canvas.findByTestId("FloatingSurface");

    await expect(canvas.queryByRole("dialog", { name: "Example surface" })).toBeNull();
    await expect(surface).not.toBeVisible();
    await expect(surface.inert).toBe(true);
  },
};
