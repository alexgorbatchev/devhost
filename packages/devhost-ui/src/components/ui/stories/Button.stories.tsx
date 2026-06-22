import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";

import { Button } from "../Button";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "../../../devtools/shared/components/stories/helpers";

const meta: Meta<typeof Button> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/Button",
  component: Button,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <Button {...args} />
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

// Helper to query within the story shadow DOM
async function getShadowCanvas(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "Button story shadow root was not created.");
  return within(shadowRoot as unknown as HTMLElement);
}

export const Default: Story = {
  args: {
    children: "Click me",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await getShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Click me" });
    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Primary: Story = {
  args: {
    children: "Primary Button",
    variant: "primary",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await getShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Primary Button" });
    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Danger: Story = {
  args: {
    children: "Danger Button",
    variant: "danger",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await getShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Danger Button" });
    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Disabled: Story = {
  args: {
    children: "Disabled Button",
    disabled: true,
    endEnhancer: "Esc",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await getShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Disabled Button" });
    const enhancer = shadowCanvas.getByText("Esc");
    await expect(button).toBeInTheDocument();
    await expect(button).toBeDisabled();
    await expect(enhancer).toBeInTheDocument();
    await fireEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(0);
  },
};

export const WithEndEnhancer: Story = {
  args: {
    children: "With Enhancer",
    endEnhancer: "✨",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await getShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: /With Enhancer/ });
    await expect(button).toBeInTheDocument();
    const enhancer = shadowCanvas.getByText("✨");
    await expect(enhancer).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const WithStartAndEndEnhancers: Story = {
  args: {
    children: "Restart service",
    endEnhancer: "⌘R",
    onClick: fn(),
    startEnhancer: "↻",
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await getShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: /Restart service/ });

    await expect(button).toBeInTheDocument();
    await expect(shadowCanvas.getByText("↻")).toBeInTheDocument();
    await expect(shadowCanvas.getByText("⌘R")).toBeInTheDocument();

    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
