import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { StackDirectoryCard } from "../StackDirectoryCard";
import { fixture_directoryStack } from "./fixtures";
import "../../statusPages.css";

const meta: Meta<typeof StackDirectoryCard> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/StackDirectoryCard",
  component: StackDirectoryCard,
  args: { stack: fixture_directoryStack },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "https://shop.localhost/" })).toHaveAttribute(
      "href",
      "https://shop.localhost/",
    );
    await expect(canvas.getByRole("link", { name: "https://shop.localhost/api/" })).toHaveAttribute(
      "href",
      "https://shop.localhost/api/",
    );
    await expect(canvas.getByRole("cell", { name: "Not started" })).toBeVisible();
    await expect(canvas.getByText("No HTTP URL")).toBeVisible();
    const configuration = canvas.getByRole("button", { name: "Configuration · 2 files" });
    await userEvent.click(configuration);
    await expect(configuration).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText("Root manifest")).toBeVisible();
    await expect(canvas.getByText("/workspace/shop/devhost.toml", { exact: true, selector: "dd" })).toBeVisible();
    await expect(canvas.getByText("2026-10-25T00:00:00Z")).toBeVisible();
    const file = canvas.getByRole("button", { name: "manifest · /workspace/shop/devhost.toml" });
    await userEvent.click(file);
    await expect(canvas.getByRole("code").textContent).toBe(fixture_directoryStack.configs[0].content);
    await userEvent.click(file);
    await expect(file).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(canvas.getByRole("button", { name: "config · /home/user/.config/devhost/config.toml" }));
    await expect(canvas.getByText("File does not exist; defaults apply.")).toBeVisible();
    await userEvent.click(configuration);
    await expect(configuration).toHaveAttribute("aria-expanded", "false");
  },
};

export const Unavailable: Story = {
  args: {
    stack: {
      ...fixture_directoryStack,
      error: "Stack details unavailable: the control server did not respond.",
      services: [],
      configs: [],
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Stack details unavailable: the control server did not respond.",
    );
    await expect(canvas.queryByRole("link")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Configuration · 0 files" }));
    await expect(canvas.getByText("/workspace/shop/devhost.toml", { exact: true, selector: "dd" })).toBeVisible();
  },
};

export const ManifestFree: Story = {
  args: {
    stack: {
      ...fixture_directoryStack,
      manifestPath: "",
      directory: "",
      startedAt: "",
      services: [{ name: "files", directory: "", status: "External", urls: ["https://files.localhost/"] }],
      configs: [],
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("cell", { name: "External" })).toBeVisible();
    await expect(canvas.getByRole("link")).toHaveAttribute("href", "https://files.localhost/");
    await userEvent.click(canvas.getByRole("button", { name: "Configuration · 0 files" }));
    await expect(canvas.getByText("Manifest-free file or port session")).toBeVisible();
    await expect(canvas.queryByText("Registered")).toBeNull();
  },
};
