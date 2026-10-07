import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "storybook/test";

import { Button } from "../Button";
import {
  readDevtoolsStoryShadowCanvas,
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

export const Default: Story = {
  args: {
    children: "Click me",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
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
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
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
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Danger Button" });
    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Warning: Story = {
  args: {
    children: "Restart changed",
    variant: "warning",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Restart changed" });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Ghost: Story = {
  args: {
    children: "Cancel",
    variant: "ghost",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Cancel" });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Pressed: Story = {
  args: {
    "aria-pressed": true,
    children: "Query",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Query", pressed: true });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const IconOnly: Story = {
  args: {
    "aria-label": "Restart api",
    startEnhancer: "↻",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Restart api" });
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
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: "Disabled Button" });
    const enhancer = shadowCanvas.getByText("Esc");
    await expect(button).toBeInTheDocument();
    await expect(button).toBeDisabled();
    await expect(enhancer).toBeInTheDocument();
    await userEvent.click(button);
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
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
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
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = shadowCanvas.getByRole("button", { name: /Restart service/ });

    await expect(button).toBeInTheDocument();
    await expect(shadowCanvas.getByText("↻")).toBeInTheDocument();
    await expect(shadowCanvas.getByText("⌘R")).toBeInTheDocument();

    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Surface: Story = {
  args: { children: "Connect browser control", variant: "surface", onClick: fn() },
  play: async ({ args, canvasElement }) => {
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = panel.getByRole("button", { name: "Connect browser control" });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await expect(button).toBeEnabled();
  },
};
