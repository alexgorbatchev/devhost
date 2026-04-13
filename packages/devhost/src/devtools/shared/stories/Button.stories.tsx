import type { Meta, StoryObj } from "@storybook/preact-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Button } from "../Button";
import { ThemeProvider } from "../ThemeProvider";

const meta: Meta<typeof Button> = {
  title: "@alexgorbatchev/devhost/devtools/shared/Button",
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
    // Try clicking disabled button, it shouldn't register a click on the function
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
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: /With Enhancer/ });
    await expect(button).toBeInTheDocument();
    const enhancer = canvas.getByText("✨");
    await expect(enhancer).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
