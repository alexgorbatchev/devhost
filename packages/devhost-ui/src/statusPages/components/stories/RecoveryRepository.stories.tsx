import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { RecoveryRepository } from "../RecoveryRepository";
import { fixture_repository } from "./fixtures";
import "../../statusPages.css";

const meta: Meta<typeof RecoveryRepository> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/RecoveryRepository",
  component: RecoveryRepository,
  args: { repository: fixture_repository, isDisabled: false, onSelect: fn(async () => {}) },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectCheckout: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Checkout" }), "/feature");
    await userEvent.click(canvas.getByRole("button", { name: "Switch worktree" }));
    await expect(args.onSelect).toHaveBeenCalledWith({ repositoryId: "repo", path: "/feature" });
  },
};
export const Blocked: Story = {
  args: {
    repository: {
      ...fixture_repository,
      blockedReason: "The current checkout was deleted",
      error: "Select an available checkout",
    },
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox")).toBeDisabled();
    await expect(canvas.getByText("The current checkout was deleted")).toBeVisible();
    await expect(canvas.getByRole("button")).toBeDisabled();
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};
export const UnavailableCheckout: Story = {
  args: {
    repository: {
      ...fixture_repository,
      worktrees: [
        ...fixture_repository.worktrees.slice(0, 1),
        { path: "/gone", branch: "", head: "deadbeef", available: false, reason: "Missing checkout", owners: [] },
      ],
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    await expect(
      within(canvasElement).getByRole("option", { name: "Detached deadbeef · /gone · Missing checkout" }),
    ).toBeDisabled();
  },
};
export const Switching: Story = {
  args: { repository: { ...fixture_repository, switching: true } },
  play: async ({ canvasElement }): Promise<void> => {
    await expect(within(canvasElement).getByRole("button")).toBeDisabled();
  },
};
