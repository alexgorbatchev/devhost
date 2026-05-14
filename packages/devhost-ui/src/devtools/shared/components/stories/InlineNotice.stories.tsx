import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";

import { InlineNotice } from "../InlineNotice";
import { devtoolsStoryShadowRootHostTestId, readShadowRoot, renderInDevtoolsStoryShadowRoot } from "./helpers";
import { StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof InlineNotice> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/InlineNotice",
  component: InlineNotice,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <InlineNotice {...args} />
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    action: <button type="button">Retry</button>,
    children: "Service health is unavailable.",
    title: "Connection failed",
    tone: "danger",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readInlineNoticeShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByRole("alert")).toHaveTextContent("Connection failed");
    await expect(shadowCanvas.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  },
};

export { Default as InlineNotice };

function readInlineNoticeShadowCanvas(canvasElement: HTMLElement): ReturnType<typeof within> {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "InlineNotice story shadow root was not created.");

  return within(shadowRoot as unknown as HTMLElement);
}
