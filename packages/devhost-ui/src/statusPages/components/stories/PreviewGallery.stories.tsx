import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";
import { PreviewGallery } from "../PreviewGallery";
import "../../statusPages.css";

const meta: Meta<typeof PreviewGallery> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/PreviewGallery",
  component: PreviewGallery,
};
export default meta;
type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent("Standalone page previews");
    await expect(canvas.getByRole("link", { name: "404 · Active hostname list" })).toHaveAttribute(
      "href",
      "route-not-found",
    );
    await expect(canvas.getByRole("link", { name: "Markdown · Rendered and source views" })).toHaveAttribute(
      "href",
      "files/notes.md",
    );
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

export { Default as PreviewGallery };
