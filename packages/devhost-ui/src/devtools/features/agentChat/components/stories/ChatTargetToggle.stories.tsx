import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ChatTargetToggle } from "../ChatTargetToggle";

const meta: Meta<typeof ChatTargetToggle> = {
  component: ChatTargetToggle,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ChatTargetToggle",
  args: { target: "project", isDisabled: false, onTargetChange: fn() },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const SwitchesTarget: Story = {
  play: async ({ canvasElement, args }) => {
    const directory = within(within(canvasElement).getByRole("group", { name: "Chat Directory" }));
    expect(directory.getByRole("button", { name: "Project" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(directory.getByRole("button", { name: "Project" }));
    expect(args.onTargetChange).not.toHaveBeenCalled();
    await userEvent.click(directory.getByRole("button", { name: "devhost" }));
    expect(args.onTargetChange).toHaveBeenCalledOnce();
    expect(args.onTargetChange).toHaveBeenCalledWith("devhost");
  },
};

export const Disabled: Story = {
  args: { target: "devhost", isDisabled: true },
  play: async ({ canvasElement }) => {
    const directory = within(within(canvasElement).getByRole("group", { name: "Chat Directory" }));
    expect(directory.getByRole("button", { name: "devhost" })).toHaveAttribute("aria-pressed", "true");
    expect(directory.getByRole("button", { name: "Project" })).toBeDisabled();
  },
};
