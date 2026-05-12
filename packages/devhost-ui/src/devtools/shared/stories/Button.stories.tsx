import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";

import { Button } from "../Button";
import { ThemeProvider } from "../ThemeProvider";

const meta: Meta<typeof Button> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/Button",
  component: Button,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <Button {...args} />
      </ThemeProvider>
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
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Click me" });
    const buttonWindow: Window | null = button.ownerDocument.defaultView;
    await expect(button).toBeInTheDocument();
    await waitFor((): void => {
      expect(buttonWindow?.getComputedStyle(button).display).toBe("inline-flex");
    });
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
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Primary Button" });
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
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Danger Button" });
    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Disabled: Story = {
  args: {
    children: "Disabled Button",
    disabled: true,
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Disabled Button" });
    await expect(button).toBeInTheDocument();
    await expect(button).toBeDisabled();
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
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: /With Enhancer/ });
    await expect(button).toBeInTheDocument();
    const enhancer = canvas.getByText("✨");
    await expect(enhancer).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
