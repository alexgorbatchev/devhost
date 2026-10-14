import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "../../../../components/ui/Button";
import { DevtoolsToolbar } from "../DevtoolsToolbar";
import { ToolbarSegment } from "../ToolbarSegment";
import {
  ResponsiveToolbarScene,
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "./helpers";

const meta: Meta<typeof DevtoolsToolbar> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/DevtoolsToolbar",
  component: DevtoolsToolbar,
  parameters: {
    viewport: {
      options: {
        toolbarMobile: {
          name: "Mobile toolbar (320 × 568)",
          styles: { width: "320px", height: "568px" },
          type: "mobile",
        },
      },
    },
  },
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

/** All toolbar groups remain available beside the minimap on a narrow phone. */
export const Mobile: Story = {
  globals: { viewport: { value: "toolbarMobile", isRotated: false } },
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <ResponsiveToolbarScene isMinimapVisible position="bottom-right" />
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const toolbar = canvas.getByRole("toolbar", { name: "devhost" });
    await waitFor(() => {
      const bounds = toolbar.getBoundingClientRect();
      expect(bounds.height).toBeGreaterThan(26);
      expect(bounds.left).toBeGreaterThanOrEqual(8);
      for (const button of within(toolbar).getAllByRole("button")) {
        expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
      }
    });
    await userEvent.click(canvas.getByRole("button", { name: /^All terminal sessions/ }));
    const sessions = canvas.getByRole("region", { name: "Terminal sessions" });
    await waitFor(() => expect(sessions).toBeVisible());
    await expect(within(sessions).getAllByRole("listitem")).toHaveLength(16);
    await userEvent.click(canvas.getByRole("button", { name: /^All terminal sessions/ }));
    await waitFor(() => expect(sessions).not.toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Collapse devhost toolbar" }));
    await expect(toolbar.getBoundingClientRect().height).toBe(26);
    await userEvent.click(canvas.getByRole("button", { name: "Expand devhost toolbar" }));
    await waitFor(() => expect(toolbar.getBoundingClientRect().height).toBeGreaterThan(26));
  },
};
