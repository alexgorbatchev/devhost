import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "storybook/test";

import { Button } from "../../../../components/ui/Button";
import { DevtoolsToolbar } from "../DevtoolsToolbar";
import { ToolbarSegment } from "../ToolbarSegment";
import { readDevtoolsStoryShadowCanvas, renderInDevtoolsStoryShadowRoot, StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof DevtoolsToolbar> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/DevtoolsToolbar",
  component: DevtoolsToolbar,
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar
          collapsedIndicator={<span aria-label="stack healthy" role="img" className="size-2 rounded-full bg-success" />}
          isMinimapVisible={false}
          position="bottom-right"
          stackName="demo-stack"
        >
          <ToolbarSegment ariaLabel="External devtools">
            <Button aria-pressed={false}>Router</Button>
            <Button aria-pressed={true}>Query</Button>
          </ToolbarSegment>
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });

    await expect(toolbar).toHaveTextContent("demo-stack");
    await expect(shadowCanvas.getByRole("group", { name: "External devtools" })).toBeVisible();
    await expect(shadowCanvas.getByRole("button", { name: "Collapse devhost toolbar" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  },
};

export const Collapsed: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Collapse devhost toolbar" }));

    const expandButton = await shadowCanvas.findByRole("button", { name: "Expand devhost toolbar" });

    await expect(expandButton).toHaveAttribute("aria-expanded", "false");
    await expect(shadowCanvas.queryByRole("group", { name: "External devtools" })).toBeNull();
    await expect(shadowCanvas.getByRole("img", { name: "stack healthy" })).toBeVisible();
    await expect(shadowCanvas.getByRole("toolbar", { name: "devhost" })).not.toHaveTextContent("demo-stack");

    await userEvent.click(expandButton);

    await expect(await shadowCanvas.findByRole("group", { name: "External devtools" })).toBeVisible();
  },
};
