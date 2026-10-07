import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "storybook/test";

import { Button } from "../../../../components/ui/Button";
import { PanelActions } from "../PanelActions";
import { readDevtoolsStoryShadowCanvas, renderInDevtoolsStoryShadowRoot, StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof PanelActions> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/PanelActions",
  component: PanelActions,
  render: (_args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <div style={{ width: 300 }}>
          <PanelActions>
            <Button>Refresh</Button>
          </PanelActions>
        </div>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

/** Actions sit at the end of the panel, across its full width. */
const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const actions = canvas.getByTestId("PanelActions").getBoundingClientRect();
    const button = canvas.getByRole("button", { name: "Refresh" }).getBoundingClientRect();

    await expect(actions.width).toBe(300);
    await expect(button.left - actions.left).toBeGreaterThan(actions.right - button.right);
  },
};

export { Default as PanelActions };
