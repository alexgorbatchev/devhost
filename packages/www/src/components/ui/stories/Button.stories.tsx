import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Button as ButtonComponent } from "../Button";

const meta: Meta<typeof ButtonComponent> = {
  title: "devhost-test-app/components/ui/Button",
  component: ButtonComponent,
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Button: Story = {
  args: {
    children: "Click me",
    onClick: fn(),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Click me" }));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await expect(canvas.getByTestId("Button")).toBeInTheDocument();
  },
};

export const Primary: Story = {
  args: {
    children: "Primary action",
    onClick: fn(),
    variant: "primary",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Primary action" });

    await expect(button).toHaveClass("bg-primary");
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

export const Large: Story = {
  args: {
    children: "Large action",
    onClick: fn(),
    size: "large",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Large action" });

    await expect(button).toHaveClass("h-11");
  },
};
