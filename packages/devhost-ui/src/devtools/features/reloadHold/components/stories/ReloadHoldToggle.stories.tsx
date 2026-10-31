import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ReloadHoldToggle } from "../ReloadHoldToggle";

const meta: Meta<typeof ReloadHoldToggle> = {
  component: ReloadHoldToggle,
  title: "@alexgorbatchev/devhost-ui/devtools/features/reloadHold/components/ReloadHoldToggle",
  args: { isEnabled: true, onToggle: fn() },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {
  play: async ({ args, canvasElement }) => {
    const toggle = within(canvasElement).getByRole("button", { name: "Hold Reloads" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    expect(args.onToggle).toHaveBeenCalledOnce();
  },
};

export const Off: Story = {
  args: { isEnabled: false },
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole("button", { name: "Hold Reloads" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  },
};
