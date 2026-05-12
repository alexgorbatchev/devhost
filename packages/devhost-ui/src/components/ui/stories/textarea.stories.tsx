import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

import { Textarea } from "../textarea";
import { ThemeProvider } from "../../../devtools/shared/ThemeProvider";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/stories/DevtoolsStoryShadowRoot";

const meta: Meta<typeof Textarea> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/textarea",
  component: Textarea,
  render: (args) => {
    return renderInDevtoolsStoryShadowRoot(
      <ThemeProvider colorScheme="dark">
        <Textarea {...args} />
      </ThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    "aria-label": "Change description",
    placeholder: "Describe the change",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
    const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "Textarea story shadow root was not created.");
    const shadowCanvas = within(shadowRoot as unknown as HTMLElement);
    const textarea = shadowCanvas.getByRole("textbox", { name: "Change description" });

    await userEvent.type(textarea, "Use shadcn tokens");
    await expect(textarea).toHaveValue("Use shadcn tokens");
  },
};

export { Default as Textarea };
