import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { Button } from "../button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../alert";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/stories/DevtoolsStoryShadowRoot";
import { StorybookThemeProvider } from "../../../devtools/shared/stories/storybookTheme";

const meta: Meta<typeof Alert> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/alert",
  component: Alert,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <Alert {...args}>
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>Check the payment method and try again.</AlertDescription>
          <AlertAction>
            <Button variant="secondary">Retry</Button>
          </AlertAction>
        </Alert>
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    variant: "destructive",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readAlertShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByRole("alert")).toHaveTextContent("Payment failed");
    await expect(shadowCanvas.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  },
};

export { Default as Alert };

function readAlertShadowCanvas(canvasElement: HTMLElement): ReturnType<typeof within> {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "Alert story shadow root was not created.");

  return within(shadowRoot as unknown as HTMLElement);
}
