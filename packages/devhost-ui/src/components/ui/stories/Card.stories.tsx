import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";

import { Card, CardHeader, CardTitle } from "../Card";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";

const meta: Meta<typeof Card> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/Card",
  component: Card,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <Card {...args}>
          <CardHeader>
            <CardTitle>Service status</CardTitle>
          </CardHeader>
          <p>api is healthy</p>
        </Card>
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {},
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByText("Service status")).toBeInTheDocument();
    await expect(shadowCanvas.getByText("api is healthy")).toBeInTheDocument();
  },
};

export { Default as Card };
