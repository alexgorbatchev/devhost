import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { HotReloadNotice } from "../HotReloadNotice";

const meta: Meta<typeof HotReloadNotice> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/hotReloadNotice/components/HotReloadNotice",
  component: HotReloadNotice,
  args: { client: "vite", onDisable: fn(), onDismiss: fn() },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Vite hot reloading is on")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Disable Reloads" }));
    expect(args.onDisable).toHaveBeenCalledOnce();
    expect(args.onDismiss).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Dismiss" }));
    expect(args.onDismiss).toHaveBeenCalledOnce();
  },
};

export { Default as HotReloadNotice };
