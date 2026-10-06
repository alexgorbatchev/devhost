import type { RGBA } from "use-color";
import { parseRgb, toRgbString } from "use-color/core";
import { contrast, ensureContrast, WCAG_THRESHOLDS } from "use-color/a11y";

export function resolveLogAnsiForeground(foreground: RGBA, background: RGBA): string {
  const adjusted = toRgbString(ensureContrast(foreground, background, WCAG_THRESHOLDS.AA));
  if (contrast(parseRgb(adjusted), background) >= WCAG_THRESHOLDS.AA) {
    return adjusted;
  }

  // Keeping chroma while adjusting lightness can exceed sRGB. Verify the serialized, clamped color;
  // when that cannot meet AA, choose the higher-contrast achromatic endpoint instead.
  const black: RGBA = { r: 0, g: 0, b: 0, a: 1 };
  const white: RGBA = { r: 255, g: 255, b: 255, a: 1 };
  return toRgbString(contrast(black, background) >= contrast(white, background) ? black : white);
}
