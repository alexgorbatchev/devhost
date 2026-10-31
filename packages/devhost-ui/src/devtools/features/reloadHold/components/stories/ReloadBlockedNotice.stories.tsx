import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ReloadBlockedNotice } from "../ReloadBlockedNotice";

const meta: Meta<typeof ReloadBlockedNotice> = {
  component: ReloadBlockedNotice,
  title: "@alexgorbatchev/devhost-ui/devtools/features/reloadHold/components/ReloadBlockedNotice",
  args: { onDismiss: fn() },
};
export default meta;
type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Reload blocked")).toBeVisible();
    expect(canvas.getByRole("button", { name: "Reload" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /dismiss/i }));
    expect(args.onDismiss).toHaveBeenCalledOnce();
  },
};

export { Default as ReloadBlockedNotice };
