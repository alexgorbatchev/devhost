import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "storybook/test";
import { ScreenshotCropEditor } from "../ScreenshotCropEditor";
import { ScreenshotShareScene, dragScreenshotArea, openScreenshotPreview } from "./helpers";

const meta: Meta<typeof ScreenshotCropEditor> = {
  component: ScreenshotCropEditor,
  title: "@alexgorbatchev/devhost-ui/devtools/features/visualAnnotations/components/ScreenshotCropEditor",
  render: () => <ScreenshotShareScene />,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const ReverseDragSelectsPixels: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openScreenshotPreview(canvasElement);
    await dragScreenshotArea(dialog);
    const width = dialog.getByRole("textbox", { name: "Width" });
    const height = dialog.getByRole("textbox", { name: "Height" });
    expect(Number(dialog.getByRole("textbox", { name: "Left" }).value)).toBeGreaterThanOrEqual(159);
    expect(Number(dialog.getByRole("textbox", { name: "Left" }).value)).toBeLessThanOrEqual(161);
    expect(Number(dialog.getByRole("textbox", { name: "Top" }).value)).toBeGreaterThanOrEqual(89);
    expect(Number(dialog.getByRole("textbox", { name: "Top" }).value)).toBeLessThanOrEqual(91);
    expect(Number(width.value)).toBeGreaterThanOrEqual(318);
    expect(Number(width.value)).toBeLessThanOrEqual(322);
    expect(Number(height.value)).toBeGreaterThanOrEqual(178);
    expect(Number(height.value)).toBeLessThanOrEqual(182);
    await userEvent.click(dialog.getByRole("button", { name: "Share Selected Area" }));
  },
};

export const ClickDoesNotSelectAnArea: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openScreenshotPreview(canvasElement);
    await userEvent.click(dialog.getByRole("img", { name: "Screenshot preview. Drag to select an area." }));
    expect(dialog.getByRole("button", { name: "Share Selected Area" })).toBeDisabled();
    await userEvent.click(dialog.getByRole("button", { name: "Cancel", exact: true }));
  },
};
