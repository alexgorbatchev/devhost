import { Button, PortalProvider } from "@alexgorbatchev/shadcn";
import { useRef, useState, type JSX } from "react";
import { expect, userEvent, within } from "storybook/test";
import { userEvent as nativeUserEvent } from "vitest/browser";
import { createScreenshotFixture } from "../../../../../../test-support/createScreenshotFixture";
import { ScreenshotShareDialog } from "../ScreenshotShareDialog";
import { useScreenshotSelection } from "../../hooks/useScreenshotSelection";
import type { ITabSnapshot } from "../../types";

interface IScreenshotShareSceneProps {
  isInvalidSnapshot?: boolean;
}

export function ScreenshotShareScene({ isInvalidSnapshot = false }: IScreenshotShareSceneProps): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null);
  const selection = useScreenshotSelection(undefined);
  const [snapshot] = useState(() => createScreenshotFixture(640, 360));
  const [shared, setShared] = useState<ITabSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <PortalProvider container={container}>
      <div ref={container}>
        <Button
          onClick={() => {
            setShared(null);
            setError(null);
            void selection
              .select(isInvalidSnapshot ? { ...snapshot, width: 641 } : snapshot)
              .then(setShared)
              .catch((error: Error) => setError(error.message));
          }}
        >
          Preview Screenshot
        </Button>
        {selection.snapshot ? (
          <ScreenshotShareDialog
            snapshot={selection.snapshot}
            onShare={selection.confirm}
            onCancel={selection.cancel}
          />
        ) : null}
        {shared ? (
          <>
            <output aria-label="Shared screenshot details">
              {JSON.stringify({ width: shared.width, height: shared.height, crop: shared.crop })}
            </output>
            <img alt="Shared screenshot" src={shared.dataUrl} />
          </>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </PortalProvider>
  );
}

export async function openScreenshotPreview(canvasElement: HTMLElement): Promise<ReturnType<typeof within>> {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Preview Screenshot" }));
  return within(await canvas.findByRole("dialog", { name: "Share Screenshot" }));
}

export async function dragScreenshotArea(dialog: ReturnType<typeof within>): Promise<void> {
  const preview = dialog.getByRole("img", { name: "Screenshot preview. Drag to select an area." });
  if (!(preview instanceof SVGSVGElement)) throw new Error("The screenshot preview is not an SVG surface.");
  const matrix = preview.getScreenCTM();
  if (matrix === null) throw new Error("The screenshot preview has no rendered transform.");
  const bounds = preview.getBoundingClientRect();
  const start = new DOMPoint(480, 270).matrixTransform(matrix);
  const end = new DOMPoint(160, 90).matrixTransform(matrix);
  await nativeUserEvent.dragAndDrop(preview, preview, {
    sourcePosition: { x: start.x - bounds.left, y: start.y - bounds.top },
    targetPosition: { x: end.x - bounds.left, y: end.y - bounds.top },
  });
  await expect(dialog.getByRole("button", { name: "Share Selected Area" })).toBeEnabled();
}

export function expectScreenshotControlsInsideViewport(dialog: ReturnType<typeof within>): void {
  const preview = dialog.getByRole("img", { name: "Screenshot preview. Drag to select an area." });
  expect(preview.getBoundingClientRect().height).toBeGreaterThan(0);
  for (const control of [...dialog.getAllByRole("button"), ...dialog.getAllByRole("textbox"), preview]) {
    const bounds = control.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
  }
}

export async function setScreenshotArea(dialog: ReturnType<typeof within>): Promise<void> {
  for (const [label, value] of [
    ["Left", "320"],
    ["Top", "180"],
    ["Width", "160"],
    ["Height", "90"],
  ]) {
    const input = dialog.getByRole("textbox", { name: label });
    await userEvent.clear(input);
    await userEvent.type(input, value);
    await expect(input).toHaveValue(value);
  }
}
