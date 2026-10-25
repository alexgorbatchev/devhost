import type { ITabSnapshot } from "../src/devtools/features/visualAnnotations/types";

export function createScreenshotFixture(width = 64, height = 32): ITabSnapshot {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "red";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "lime";
  context.fillRect(width / 2, height / 2, width / 2, height / 2);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}
