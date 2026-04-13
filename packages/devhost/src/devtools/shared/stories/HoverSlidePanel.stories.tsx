import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, within } from "storybook/test";

import { HoverSlidePanel } from "../HoverSlidePanel";
import { ThemeProvider } from "../ThemeProvider";

const meta: Meta<typeof HoverSlidePanel> = {
  title: "@alexgorbatchev/devhost/devtools/shared/HoverSlidePanel",
  component: HoverSlidePanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <HoverSlidePanel {...args} />
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {
    ariaLabel: "Example hover panel",
    children: <div>Panel content</div>,
    panelSide: "left",
    peekWidth: "32px",
    style: {
      width: "160px",
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("HoverSlidePanel")).toBeInTheDocument();
    await expect(canvas.getByText("Panel content")).toBeInTheDocument();
  },
};

export { Default as HoverSlidePanel };
