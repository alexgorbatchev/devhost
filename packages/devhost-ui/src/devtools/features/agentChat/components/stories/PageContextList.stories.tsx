import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { PageContextList } from "../PageContextList";
const meta: Meta<typeof PageContextList> = {
  component: PageContextList,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/PageContextList",
  args: {
    targets: [],
    shapes: [{ id: "box", kind: "box", start: { x: 0, y: 0 }, end: { x: 40, y: 30 } }],
    isDisabled: false,
    onRemoveTarget: fn(),
    onRemoveShape: fn(),
    onClear: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const RemoveDrawing: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Remove Box 1" }));
    expect(args.onRemoveShape).toHaveBeenCalledWith("box");
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Clear Page Context" }));
    expect(args.onClear).toHaveBeenCalledOnce();
  },
};
export const Empty: Story = {
  args: { shapes: [] },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole("region", { name: "Page context" })).toBeNull();
  },
};
