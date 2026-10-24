import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { WorktreeOwner } from "../WorktreeOwner";
import { fixture_owner } from "./fixtures";
import "../../statusPages.css";

const meta: Meta<typeof WorktreeOwner> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/WorktreeOwner",
  component: WorktreeOwner,
  args: {
    owner: fixture_owner,
    repositoryId: "repo",
    path: "/feature",
    isDisabled: false,
    onSelect: fn(async () => {}),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Occupied: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link")).toHaveAttribute("href", fixture_owner.urls[0]);
    await expect(canvas.getByRole("link")).toHaveAttribute("target", "_blank");
    await userEvent.click(canvas.getByRole("button", { name: "Stop stack" }));
    await expect(args.onSelect).toHaveBeenCalledWith({ repositoryId: "repo", path: "/feature", stopOwnerId: "owner" });
  },
};
export const Pending: Story = {
  args: { isDisabled: true },
  play: async ({ args, canvasElement }): Promise<void> => {
    const button = within(canvasElement).getByRole("button");
    await expect(button).toBeDisabled();
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};
export const NoRoutedPage: Story = {
  args: { owner: { ...fixture_owner, urls: [] } },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("This stack has no routed page.")).toBeVisible();
    await expect(canvas.queryByRole("link")).toBeNull();
  },
};
