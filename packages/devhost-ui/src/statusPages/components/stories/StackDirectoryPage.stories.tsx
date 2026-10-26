import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { StackDirectoryPage } from "../StackDirectoryPage";
import { fixture_directoryStack } from "./fixtures";
import "../../statusPages.css";

const meta: Meta<typeof StackDirectoryPage> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/StackDirectoryPage",
  component: StackDirectoryPage,
  args: { stacks: [fixture_directoryStack], query: "" },
  parameters: {
    viewport: {
      options: {
        directoryPhone: { name: "Directory phone", styles: { width: "360px", height: "800px" } },
      },
    },
  },
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
        name: "a-much-longer-stack-name",
        pid: 456,
        services: [
          { name: "api-with-a-long-service-name", directory: "", status: "Running", urls: ["https://api.localhost/"] },
        ],
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
    const shop = canvas.getByRole("region", { name: "shop" });
    const api = canvas.getByRole("region", { name: "a-much-longer-stack-name" });
    await userEvent.click(within(shop).getByRole("button", { name: "Configuration · 2 files" }));
    await userEvent.click(within(api).getByRole("button", { name: "Configuration · 2 files" }));
    await waitFor(() => {
      const first = shop.getBoundingClientRect();
      const second = api.getBoundingClientRect();
      expect(first.left).toBe(second.left);
      expect(first.width).toBe(second.width);
      expect(second.top).toBeGreaterThanOrEqual(first.bottom);
      for (const label of ["Service", "Status", "URLs / directory"]) {
        expect(within(shop).getByRole("columnheader", { name: label }).getBoundingClientRect().left).toBe(
          within(api).getByRole("columnheader", { name: label }).getBoundingClientRect().left,
        );
      }
      expect(
        within(shop)
          .getByRole("row", { name: /web Running/ })
          .getBoundingClientRect().height,
      ).toBeLessThan(110);
      for (const label of ["Directory", "Root manifest", "Registered"]) {
        expect(within(shop).getByText(label, { exact: true }).getBoundingClientRect().left).toBe(
          within(api).getByText(label, { exact: true }).getBoundingClientRect().left,
        );
      }
      expect(
        within(shop).getByText("/workspace/shop/devhost.toml", { exact: true, selector: "dd" }).getBoundingClientRect()
          .left,
      ).toBe(
        within(api).getByText("/workspace/shop/devhost.toml", { exact: true, selector: "dd" }).getBoundingClientRect()
          .left,
      );
    });
  },
};

export const Narrow: Story = {
  globals: { viewport: { value: "directoryPhone", isRotated: false } },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "https://shop.localhost/" })).toBeVisible();
    await expect(canvas.getByRole("cell", { name: "worker Not started" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Configuration · 2 files" }));
    await userEvent.click(canvas.getByRole("button", { name: "manifest · /workspace/shop/devhost.toml" }));
    await expect(canvas.getByRole("code")).toHaveTextContent('name = "shop"');
    await waitFor(() => {
      const page = canvas.getByRole("main");
      expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
      expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
        canvasElement.ownerDocument.documentElement.clientWidth,
      );
    });
  },
};
