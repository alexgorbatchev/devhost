import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { Badge } from "../badge";
import { ThemeProvider } from "../../../devtools/shared/ThemeProvider";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/stories/DevtoolsStoryShadowRoot";

const meta: Meta<typeof Badge> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/badge",
  component: Badge,
  render: (args) => {
    return renderInDevtoolsStoryShadowRoot(
      <ThemeProvider colorScheme="dark">
        <Badge {...args} />
      </ThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    children: "managed",
    variant: "secondary",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
    const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "Badge story shadow root was not created.");
    const shadowCanvas = within(shadowRoot as unknown as HTMLElement);

    await expect(shadowCanvas.getByText("managed")).toBeInTheDocument();
  },
};

export { Default as Badge };
