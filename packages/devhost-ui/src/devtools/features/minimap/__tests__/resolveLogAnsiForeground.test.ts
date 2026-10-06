import { describe, expect, test } from "bun:test";
import { parseRgb } from "use-color/core";
import { contrast } from "use-color/a11y";

import { resolveLogAnsiForeground } from "../resolveLogAnsiForeground";

describe("resolveLogAnsiForeground", () => {
  test("retains an already-readable service foreground", () => {
    const foreground = parseRgb("rgb(51, 255, 51)");
    expect(resolveLogAnsiForeground(foreground, parseRgb("rgb(0, 0, 0)"))).toBe("rgb(51, 255, 51)");
  });

  test("meets AA across neutral and saturated sRGB foreground/background pairs", () => {
    const channels: number[] = [0, 64, 128, 192, 255];
    const colors = channels.flatMap((r) => channels.flatMap((g) => channels.map((b) => ({ r, g, b, a: 1 }))));
    for (const foreground of colors) {
      for (const background of colors) {
        const result = parseRgb(resolveLogAnsiForeground(foreground, background));
        expect(contrast(result, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
