import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { FilePage } from "../FilePage";
import { fixture_filePage, fixture_markdownPage } from "./fixtures";
import "../../statusPages.css";

const meta: Meta<typeof FilePage> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/FilePage",
  component: FilePage,
  args: { data: fixture_filePage },
  beforeEach: () => {
    localStorage.removeItem("devhost.files.markdown.source");
    return () => localStorage.removeItem("devhost.files.markdown.source");
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Directory: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent("Directory listing");
    await expect(canvas.getByRole("link", { name: "read me.md" })).toHaveAttribute("href", "read%20me.md");
    await expect(canvas.getByRole("link", { name: "images/" })).toHaveAttribute("href", "images/");
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

export const EmptyDirectory: Story = {
  args: { data: { ...fixture_filePage, entries: [] } },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("This directory is empty")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "devhost" })).toHaveAttribute("href", "/");
    await expect(canvas.getByRole("link", { name: "notes" })).not.toHaveAttribute("href");
    await expect(canvas.queryByRole("link", { name: "read me.md" })).toBeNull();
  },
};

export const RenderedMarkdown: Story = {
  args: { data: fixture_markdownPage },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Notes" })).toBeVisible();
    await expect(canvas.getByRole("table")).toBeVisible();
    await expect(canvas.getByRole("checkbox")).toBeChecked();
    await expect(canvas.getByRole("checkbox")).toBeDisabled();
    await expect(canvas.getByText("Unsafe")).toHaveAttribute("href", "");
    await expect(canvasElement.querySelector("article script")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Show source" }));
    await expect(canvas.getByRole("code").textContent).toBe(fixture_markdownPage.source);
    await expect(canvas.getByRole("code")).toBeVisible();
    await expect(canvas.queryByRole("heading", { name: "Notes" })).toBeNull();
    await expect(localStorage.getItem("devhost.files.markdown.source")).toBe("true");
  },
};

export const RememberedSource: Story = {
  args: { data: fixture_markdownPage },
  beforeEach: () => {
    localStorage.setItem("devhost.files.markdown.source", "true");
    return () => localStorage.removeItem("devhost.files.markdown.source");
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("code").textContent).toBe(fixture_markdownPage.source);
    await expect(canvas.getByRole("code")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Show rendered" }));
    await expect(canvas.getByRole("heading", { name: "Notes" })).toBeVisible();
    await expect(canvas.queryByRole("code")).toBeNull();
    await expect(localStorage.getItem("devhost.files.markdown.source")).toBe("false");
  },
};
