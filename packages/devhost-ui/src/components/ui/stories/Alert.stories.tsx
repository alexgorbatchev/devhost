import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";

import { Button } from "../Button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../Alert";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";

const meta: Meta<typeof Alert> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/Alert",
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
              <Button>Retry</Button>
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
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    const alerts = shadowCanvas.getAllByRole("alert");

    await expect(alerts).toHaveLength(2);
    await expect(alerts[0]).toHaveTextContent("Service connected");
    await expect(alerts[1]).toHaveTextContent("Payment failed");
    await expect(shadowCanvas.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  },
};

export { Default as Alert };
