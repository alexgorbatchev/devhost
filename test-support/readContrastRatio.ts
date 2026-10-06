import type { IContrastTarget } from "./types";

// Kept self-contained so Playwright can serialize this function into the browser as well as Storybook calling it.
// Canvas parses and composites CSS colors natively; luminance follows WCAG's sRGB definition.
export function readContrastRatio(element: Element, target: IContrastTarget = {}): number {
  const parentOf = (current: Element): Element | null => {
    const root = current.getRootNode();
    return current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  };
  const luminance = (pixels: Uint8ClampedArray): number => {
    const weights: number[] = [0.2126, 0.7152, 0.0722];
    return Array.from(pixels)
      .slice(0, 3)
      .reduce((sum, channel, index) => {
        const srgb = channel / 255;
        const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
        return sum + linear * weights[index];
      }, 0);
  };
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    throw new Error("Contrast measurement requires a 2D canvas.");
  }
  const ancestors: Element[] = [];
  let current: Element | null = target.useParentBackground ? parentOf(element) : element;
  while (current !== null) {
    ancestors.unshift(current);
    current = parentOf(current);
  }
  context.fillStyle = "white";
  context.fillRect(0, 0, 1, 1);
  for (const ancestor of ancestors) {
    context.fillStyle = getComputedStyle(ancestor).backgroundColor;
    context.fillRect(0, 0, 1, 1);
  }
  const background = luminance(context.getImageData(0, 0, 1, 1).data);
  let opacity = 1;
  current = element;
  while (current !== null) {
    opacity *= Number(getComputedStyle(current).opacity);
    current = parentOf(current);
  }
  const foregroundStyle = getComputedStyle(element, target.pseudoElement);
  context.globalAlpha = opacity * (target.pseudoElement ? Number(foregroundStyle.opacity) : 1);
  context.fillStyle = foregroundStyle[target.property ?? "color"];
  context.fillRect(0, 0, 1, 1);
  const foreground = luminance(context.getImageData(0, 0, 1, 1).data);
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
}
