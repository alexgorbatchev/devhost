import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { Card, CardContent, CardHeader, CardTitle } from "../card";
import { ThemeProvider } from "../../../devtools/shared/ThemeProvider";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/stories/DevtoolsStoryShadowRoot";

const meta: Meta<typeof Card> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/card",
  component: Card,
  render: (args) => {
    return renderInDevtoolsStoryShadowRoot(
      <ThemeProvider colorScheme="dark">
        <Card {...args}>
          <CardHeader>
            <CardTitle>Service status</CardTitle>
          </CardHeader>
          <CardContent>api is healthy</CardContent>
        </Card>
      </ThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {},
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
    const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "Card story shadow root was not created.");
    const shadowCanvas = within(shadowRoot as unknown as HTMLElement);

    await expect(shadowCanvas.getByText("Service status")).toBeInTheDocument();
    await expect(shadowCanvas.getByText("api is healthy")).toBeInTheDocument();
  },
};

export { Default as Card };
