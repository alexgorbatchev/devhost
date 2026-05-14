import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { Button } from "../button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../alert";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";

const meta: Meta<typeof Alert> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/alert",
  component: Alert,
  render: (_args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <div className="grid gap-3">
          <Alert>
            <AlertTitle>Service connected</AlertTitle>
            <AlertDescription>The development service is responding normally.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>Check the payment method and try again.</AlertDescription>
            <AlertAction>
              <Button variant="secondary">Retry</Button>
            </AlertAction>
          </Alert>
        </div>
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readAlertShadowCanvas(canvasElement);

    const alerts = shadowCanvas.getAllByRole("alert");

    await expect(alerts).toHaveLength(2);
    await expect(alerts[0]).toHaveTextContent("Service connected");
    await expect(alerts[1]).toHaveTextContent("Payment failed");
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
