import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within, waitFor } from "storybook/test";

import { HoverSlidePanel } from "../HoverSlidePanel";
import { StoryContainer } from "./StoryContainer";
import { StorybookThemeProvider } from "./storybookTheme";

const meta: Meta<typeof HoverSlidePanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/HoverSlidePanel",
  component: HoverSlidePanel,
  render: (args, context) => {
    return (
      <StorybookThemeProvider globals={context.globals}>
        <StoryContainer align="right">
          <HoverSlidePanel {...args} />
        </StoryContainer>
      </StorybookThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    ariaLabel: "Hover panel",
    children: <div className="w-40">Hover Panel Content</div>,
    peekWidth: "32px",
    testId: "hover-slide-panel",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const panel = await canvas.findByTestId("hover-slide-panel");
    await expect(panel).toBeInTheDocument();
    await expect(canvas.getByText("Hover Panel Content")).toBeInTheDocument();

    // Test hover interaction
    const beforeHoverTransform = window.getComputedStyle(panel).transform;
    await userEvent.hover(panel);
    await waitFor(() => {
      expect(window.getComputedStyle(panel).transform).not.toEqual(beforeHoverTransform);
    });
    await userEvent.unhover(panel);
  },
};

export const Pinned: Story = {
  args: {
    ariaLabel: "Pinned hover panel",
    children: <div className="w-40">Pinned Panel Content</div>,
    isPinned: true,
    peekWidth: "32px",
    testId: "hover-slide-panel-pinned",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const panel = await canvas.findByTestId("hover-slide-panel-pinned");
    const pinnedTransform = window.getComputedStyle(panel).transform;

    await expect(canvas.getByText("Pinned Panel Content")).toBeInTheDocument();

    await userEvent.hover(panel);
    await waitFor(() => {
      expect(window.getComputedStyle(panel).transform).toEqual(pinnedTransform);
    });

    await userEvent.unhover(panel);
    await waitFor(() => {
      expect(window.getComputedStyle(panel).transform).toEqual(pinnedTransform);
    });
  },
};
