import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { PageAnnotationToolbar } from "../PageAnnotationToolbar";

const meta: Meta<typeof PageAnnotationToolbar> = {
  component: PageAnnotationToolbar,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/PageAnnotationToolbar",
  args: { tool: null, isSelecting: false, isDisabled: false, canUndo: true, onToolChange: fn(), onUndo: fn() },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Tools: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Arrow" }));
    expect(args.onToolChange).toHaveBeenCalledWith("arrow");
    await userEvent.click(canvas.getByRole("button", { name: "Select Elements" }));
    expect(args.onToolChange).toHaveBeenCalledWith("select");
    await userEvent.click(canvas.getByRole("button", { name: "Undo Drawing" }));
    expect(args.onUndo).toHaveBeenCalledOnce();
  },
};
export const Disabled: Story = {
  args: { isDisabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("button", { name: "Arrow" })).toBeDisabled();
    expect(canvas.getByRole("button", { name: "Undo Drawing" })).toBeDisabled();
  },
};
