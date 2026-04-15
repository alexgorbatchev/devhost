import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within, waitFor } from "storybook/test";

import { HoverSlidePanel } from "../HoverSlidePanel";
import { ThemeProvider } from "../ThemeProvider";
import { StoryContainer } from "./StoryContainer";

const meta: Meta<typeof HoverSlidePanel> = {
  title: "@alexgorbatchev/devhost/devtools/shared/HoverSlidePanel",
  component: HoverSlidePanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <StoryContainer align={args.panelSide}>
          <HoverSlidePanel {...args} />
        </StoryContainer>
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const LeftPanel: Story = {
  args: {
    ariaLabel: "Left hover panel",
    children: <div>Left Panel Content</div>,
    panelSide: "left",
    peekWidth: "32px",
    style: {
      width: "160px",
    },
    testId: "hover-slide-panel-left",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const panel = await canvas.findByTestId("hover-slide-panel-left");
    await expect(panel).toBeInTheDocument();
    await expect(canvas.getByText("Left Panel Content")).toBeInTheDocument();

    // Test hover interaction
    const beforeHoverTransform = window.getComputedStyle(panel).transform;
    await userEvent.hover(panel);
    await waitFor(() => {
      expect(window.getComputedStyle(panel).transform).not.toEqual(beforeHoverTransform);
    });
    await userEvent.unhover(panel);
  },
};

export const RightPanel: Story = {
  args: {
    ariaLabel: "Right hover panel",
    children: <div>Right Panel Content</div>,
    panelSide: "right",
    peekWidth: "32px",
    style: {
      width: "160px",
    },
    testId: "hover-slide-panel-right",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const panel = await canvas.findByTestId("hover-slide-panel-right");
    await expect(panel).toBeInTheDocument();
    await expect(canvas.getByText("Right Panel Content")).toBeInTheDocument();

    // Test hover interaction
    const beforeHoverTransform = window.getComputedStyle(panel).transform;
    await userEvent.hover(panel);
    await waitFor(() => {
      expect(window.getComputedStyle(panel).transform).not.toEqual(beforeHoverTransform);
    });
    await userEvent.unhover(panel);
  },
};

export const PinnedLeftPanel: Story = {
  args: {
    ariaLabel: "Pinned hover panel",
    children: <div>Pinned Panel Content</div>,
    isPinned: true,
    panelSide: "left",
    peekWidth: "32px",
    style: {
      width: "160px",
    },
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
