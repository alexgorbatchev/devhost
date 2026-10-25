import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { StackDirectoryPage } from "../StackDirectoryPage";
import { fixture_directoryStack } from "./fixtures";
import "../../statusPages.css";

const meta: Meta<typeof StackDirectoryPage> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/StackDirectoryPage",
  component: StackDirectoryPage,
  args: { stacks: [fixture_directoryStack], query: "" },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("1 stack")).toBeVisible();
    await expect(canvas.getByText("2 URLs")).toBeVisible();
    const filter = canvas.getByRole("searchbox", { name: "Filter stacks" });
    await userEvent.type(filter, "shop.localhost");
    await expect(filter).toHaveValue("shop.localhost");
    await expect(canvas.getByRole("search")).toHaveAttribute("method", "get");
    await expect(canvas.getByRole("button", { name: "Refresh / filter" })).toHaveAttribute("type", "submit");
    await expect(canvas.queryByRole("link", { name: "Clear filter" })).toBeNull();
  },
};

export const Empty: Story = {
  args: { stacks: [] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No stacks running")).toBeVisible();
    await expect(canvas.getByText("Start a project with devhost start, then refresh this page.")).toBeVisible();
    await expect(canvas.queryByRole("link")).toBeNull();
  },
};

export const NoMatches: Story = {
  args: { stacks: [], query: "missing" },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Showing results for “missing”");
    await expect(canvas.getByRole("searchbox")).toHaveValue("missing");
    await expect(canvas.getByText("No matching stacks")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Show all stacks" })).toHaveAttribute("href", "?");
    await expect(canvas.getByRole("link", { name: "Clear filter" })).toHaveAttribute("href", "?");
  },
};

export const MultipleStacks: Story = {
  args: {
    stacks: [
      fixture_directoryStack,
      {
        ...fixture_directoryStack,
        name: "api",
        pid: 456,
        services: [{ name: "api", directory: "", status: "Running", urls: ["https://api.localhost/"] }],
      },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("2 stacks")).toBeVisible();
    await expect(canvas.getByText("3 URLs")).toBeVisible();
    await expect(canvas.getAllByRole("region")).toHaveLength(2);
    await expect(canvas.getByRole("link", { name: "https://api.localhost/" })).toHaveAttribute(
      "href",
      "https://api.localhost/",
    );
  },
};
