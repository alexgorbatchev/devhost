import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";
import { FileBreadcrumbs } from "../FileBreadcrumbs";
import { fixture_filePage } from "./fixtures";
import "../../statusPages.css";

const meta: Meta<typeof FileBreadcrumbs> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/FileBreadcrumbs",
  component: FileBreadcrumbs,
  args: { breadcrumbs: fixture_filePage.breadcrumbs },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Nested: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "devhost" })).toHaveAttribute("href", "/");
    await expect(canvas.getByRole("link", { name: "notes" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByRole("link", { name: "notes" })).not.toHaveAttribute("href");
  },
};

export const Root: Story = {
  args: { breadcrumbs: [{ name: "devhost", href: "" }] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "devhost" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByRole("link", { name: "devhost" })).toHaveAttribute("aria-disabled", "true");
    await expect(canvas.getByRole("link", { name: "devhost" })).not.toHaveAttribute("href");
  },
};
