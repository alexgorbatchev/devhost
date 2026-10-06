import type { RGBA } from "use-color";

import type { ILogAnsiFragment } from "./parseAnsiLogLine";
import { resolveLogAnsiForeground } from "./resolveLogAnsiForeground";

export function readLogAnsiForeground(element: HTMLElement, fragment: ILogAnsiFragment): string {
  const canvas = element.ownerDocument.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    throw new Error("ANSI contrast adjustment requires a 2D canvas.");
  }

  // Use rendered backgrounds, including translucent focused/error rows and explicit ANSI backgrounds.
  // Native canvas accepts computed CSS color formats and performs the same sRGB compositing as the browser.
  const ancestors: Element[] = [];
  let current: Element | null = element;
  while (current !== null) {
    ancestors.unshift(current);
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  context.fillStyle = "white";
  context.fillRect(0, 0, 1, 1);
  for (const ancestor of ancestors) {
    context.fillStyle = getComputedStyle(ancestor).backgroundColor;
    context.fillRect(0, 0, 1, 1);
  }
  const background = readCanvasColor(context);
  context.fillStyle = fragment.foregroundColor ?? getComputedStyle(element.parentElement ?? element).color;
  // Dim only the foreground, so an ANSI background remains opaque. Adjustment can limit dimming to meet AA.
  context.globalAlpha = fragment.isDim ? 0.7 : 1;
  context.fillRect(0, 0, 1, 1);
  return resolveLogAnsiForeground(readCanvasColor(context), background);
}

function readCanvasColor(context: CanvasRenderingContext2D): RGBA {
  const pixels = context.getImageData(0, 0, 1, 1).data;
  return { r: pixels[0], g: pixels[1], b: pixels[2], a: 1 };
}
