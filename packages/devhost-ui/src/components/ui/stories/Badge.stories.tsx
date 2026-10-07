import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";

import { Badge } from "../Badge";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";

const meta: Meta<typeof Badge> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/Badge",
  component: Badge,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <Badge {...args} />
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "external",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("external")).toBeInTheDocument();
  },
};

export const Primary: Story = {
  args: {
    children: "working",
    variant: "primary",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("working")).toBeInTheDocument();
  },
};

export const Destructive: Story = {
  args: {
    children: "paused",
    variant: "destructive",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("paused")).toBeInTheDocument();
  },
};

export const Warning: Story = {
  args: {
    children: "changed",
    variant: "warning",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("changed")).toBeInTheDocument();
  },
};

export const Success: Story = {
  args: {
    children: "finished",
    variant: "success",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("finished")).toBeInTheDocument();
  },
};
