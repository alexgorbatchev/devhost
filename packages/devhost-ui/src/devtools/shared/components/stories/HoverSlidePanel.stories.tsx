import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within, waitFor } from "storybook/test";

import { HoverSlidePanel } from "../HoverSlidePanel";
import { devtoolsStoryShadowRootHostTestId, readShadowRoot, renderInDevtoolsStoryShadowRoot } from "./helpers";
import { StoryContainer } from "./helpers";
import { StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof HoverSlidePanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/HoverSlidePanel",
  component: HoverSlidePanel,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <StoryContainer align="right">
          <HoverSlidePanel {...args} />
        </StoryContainer>
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    ariaLabel: "Hover panel",
    children: <div className="w-40">Hover Panel Content</div>,
    testId: "hover-slide-panel",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readHoverSlidePanelShadowCanvas(canvasElement);
    const panel = await shadowCanvas.findByTestId("hover-slide-panel");
    await expect(panel).toBeInTheDocument();
    await expect(shadowCanvas.getByText("Hover Panel Content")).toBeInTheDocument();

    const restingLeft = panel.getBoundingClientRect().left;

    await userEvent.hover(panel);
    await waitFor(() => {
      expect(panel.getBoundingClientRect().left).toBeLessThan(restingLeft);
    });

    await userEvent.unhover(panel);

    await waitFor(() => {
      expect(panel.getBoundingClientRect().left).toEqual(restingLeft);
    });
  },
};

export const Pinned: Story = {
  args: {
    ariaLabel: "Pinned hover panel",
    children: <div className="w-40">Pinned Panel Content</div>,
    isPinned: true,
    testId: "hover-slide-panel-pinned",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readHoverSlidePanelShadowCanvas(canvasElement);
    const panel = await shadowCanvas.findByTestId("hover-slide-panel-pinned");
    const pinnedLeft = panel.getBoundingClientRect().left;

    await expect(shadowCanvas.getByText("Pinned Panel Content")).toBeInTheDocument();

    await userEvent.hover(panel);
    await waitFor(() => {
      expect(panel.getBoundingClientRect().left).toEqual(pinnedLeft);
    });

    await userEvent.unhover(panel);
    await waitFor(() => {
      expect(panel.getBoundingClientRect().left).toEqual(pinnedLeft);
    });
  },
};

export const WithHeaderAndError: Story = {
  args: {
    actions: <button type="button">Retry</button>,
    ariaLabel: "Services panel",
    children: <div className="w-40">Panel Content</div>,
    description: "Review current service availability.",
    error: "Service health is unavailable.",
    testId: "hover-slide-panel-with-header",
    title: "Services",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readHoverSlidePanelShadowCanvas(canvasElement);
    const panel = await shadowCanvas.findByTestId("hover-slide-panel-with-header");

    await expect(panel).toBeInTheDocument();
    await expect(shadowCanvas.getByText("Services")).toBeInTheDocument();
    await expect(shadowCanvas.getByText("Review current service availability.")).toBeInTheDocument();
    await expect(shadowCanvas.getByRole("alert")).toHaveTextContent("Service health is unavailable.");
    await expect(shadowCanvas.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  },
};

function readHoverSlidePanelShadowCanvas(canvasElement: HTMLElement): ReturnType<typeof within> {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "HoverSlidePanel story shadow root was not created.");

  return within(shadowRoot as unknown as HTMLElement);
}
