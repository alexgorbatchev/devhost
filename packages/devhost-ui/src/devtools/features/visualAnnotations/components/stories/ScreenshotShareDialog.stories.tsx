import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ScreenshotShareDialog } from "../ScreenshotShareDialog";
import {
  ScreenshotShareScene,
  openScreenshotPreview,
  setScreenshotArea,
  expectScreenshotControlsInsideViewport,
} from "./helpers";

const meta: Meta<typeof ScreenshotShareDialog> = {
  component: ScreenshotShareDialog,
  title: "@alexgorbatchev/devhost-ui/devtools/features/visualAnnotations/components/ScreenshotShareDialog",
  render: () => <ScreenshotShareScene />,
  parameters: {
    viewport: {
      options: {
        screenshotMobile: { name: "Mobile screenshot", styles: { width: "320px", height: "568px" }, type: "mobile" },
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const ShareWholeTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await openScreenshotPreview(canvasElement);
    expect(dialog.getByRole("button", { name: "Share Selected Area" })).toBeDisabled();
    await userEvent.click(dialog.getByRole("button", { name: "Share Whole Tab" }));
    await waitFor(() => expect(canvas.queryByRole("dialog", { name: "Share Screenshot" })).toBeNull());
    expect(canvas.getByLabelText("Shared screenshot details")).toHaveTextContent('{"width":640,"height":360}');
  },
};

export const ShareSelectedPixels: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await openScreenshotPreview(canvasElement);
    expectScreenshotControlsInsideViewport(dialog);
    await setScreenshotArea(dialog);
    await userEvent.click(dialog.getByRole("button", { name: "Share Selected Area" }));
    await waitFor(() => expect(canvas.queryByRole("dialog", { name: "Share Screenshot" })).toBeNull());
    expect(canvas.getByLabelText("Shared screenshot details")).toHaveTextContent(
      '{"width":160,"height":90,"crop":{"x":320,"y":180,"width":160,"height":90,"sourceWidth":640,"sourceHeight":360}}',
    );
    const image = canvas.getByAltText<HTMLImageElement>("Shared screenshot");
    await waitFor(() => expect(image.naturalWidth).toBe(160));
    expect(image.naturalHeight).toBe(90);
  },
};

export const CancelAndRetry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await openScreenshotPreview(canvasElement);
    await setScreenshotArea(dialog);
    await userEvent.click(dialog.getByRole("button", { name: "Cancel", exact: true }));
    expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Screenshot sharing cancelled. Your draft and page context have been retained.",
    );
    expect(canvas.queryByAltText("Shared screenshot")).toBeNull();
    const next = await openScreenshotPreview(canvasElement);
    expect(next.getByRole("button", { name: "Share Selected Area" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("dialog", { name: "Share Screenshot" })).toBeNull());
  },
};

export const CropFailureKeepsWholeTabAvailable: Story = {
  render: () => <ScreenshotShareScene isInvalidSnapshot />,
  play: async ({ canvasElement }) => {
    const dialog = await openScreenshotPreview(canvasElement);
    await setScreenshotArea(dialog);
    await userEvent.click(dialog.getByRole("button", { name: "Share Selected Area" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("The screenshot dimensions do not match its image.");
    expect(dialog.getByRole("button", { name: "Share Whole Tab" })).toBeEnabled();
    await userEvent.click(dialog.getByRole("button", { name: "Cancel", exact: true }));
  },
};

export const MobileSelection: Story = {
  ...ShareSelectedPixels,
  globals: { viewport: { value: "screenshotMobile", isRotated: false } },
  play: ShareSelectedPixels.play,
};

export const LightSelection: Story = {
  ...ShareSelectedPixels,
  globals: { devhostTheme: "light" },
  play: ShareSelectedPixels.play,
};
