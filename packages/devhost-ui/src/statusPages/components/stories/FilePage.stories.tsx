import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { FilePage } from "../FilePage";
import {
  fixture_filePage,
  fixture_frontMatterMarkdownPage,
  fixture_invalidFrontMatterMarkdownPage,
  fixture_markdownPage,
  fixture_nestedFrontMatterMarkdownPage,
} from "./fixtures";
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

export const FrontMatterRendersAsTable: Story = {
  args: { data: fixture_frontMatterMarkdownPage },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const rendered = canvasElement.querySelector("#rendered");
    const frontMatter = canvas.getByRole("table", { name: "Front matter" });
    await expect(rendered?.firstElementChild).toBe(frontMatter);
    await expect(
      within(frontMatter)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["created_on", "last_modified", "status"]);
    await expect(
      within(frontMatter)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["2026-11-15 07:44", "2026-11-15 09:30", "current"]);
    // The metadata is neither a heading nor stray paragraph text, and a later `---` is still a thematic break.
    await expect(canvas.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Notes"]);
    await expect(Array.from(rendered?.querySelectorAll("p") ?? [], (paragraph) => paragraph.textContent)).toEqual([
      "Introduction.",
      "After the break.",
    ]);
    await expect(canvas.getAllByRole("separator").filter((separator) => rendered?.contains(separator))).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "Show source" }));
    await expect(canvas.getByRole("code").textContent).toBe(fixture_frontMatterMarkdownPage.source);
    await expect(canvas.queryByRole("table", { name: "Front matter" })).toBeNull();
  },
};

export const NestedFrontMatterRendersReadably: Story = {
  args: { data: fixture_nestedFrontMatterMarkdownPage },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const frontMatter = canvas.getByRole("table", { name: "Front matter" });
    const keys = Array.from(frontMatter.querySelectorAll(":scope > thead > tr > th"), (key) => key.textContent);
    await expect(keys).toEqual(["title", "tags", "owner", "steps", "reviewer"]);
    const [title, tags, owner, steps, reviewer] = Array.from(frontMatter.querySelectorAll(":scope > tbody > tr > td"));
    await expect(title).toHaveTextContent("Release notes");
    // Lists of plain values read as one line.
    await expect(tags?.textContent).toBe("cli, docs");
    // A mapping nests its own key/value table.
    const ownerKeys = owner?.querySelectorAll(":scope > table > thead > tr > th");
    await expect(Array.from(ownerKeys ?? [], (key) => key.textContent)).toEqual(["name", "teams"]);
    const ownerValues = owner?.querySelectorAll(":scope > table > tbody > tr > td");
    await expect(Array.from(ownerValues ?? [], (cell) => cell.textContent)).toEqual(["Ada", "core, docs"]);
    // A list of mappings shows one nested table per item.
    const stepValues = steps?.querySelectorAll(":scope > table > tbody > tr > td > table > tbody > tr > td");
    await expect(Array.from(stepValues ?? [], (cell) => cell.textContent)).toEqual(["build", "test"]);
    await expect(reviewer?.textContent).toBe("");
    await expect(canvas.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Notes"]);
  },
};

export const InvalidFrontMatterRendersAsCode: Story = {
  args: { data: fixture_invalidFrontMatterMarkdownPage },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const block = canvasElement.querySelector("#rendered")?.firstElementChild;
    await expect(block?.tagName).toBe("PRE");
    await expect(block?.textContent).toBe("title: [unclosed\nstatus: current");
    await expect(canvas.queryByRole("table")).toBeNull();
    await expect(canvas.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Notes"]);
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
