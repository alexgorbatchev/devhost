import { describe, expect, test } from "bun:test";

import { resolveContrastingColorScheme } from "../resolveContrastingColorScheme";

describe("resolveContrastingColorScheme", () => {
  test("returns dark for a light host color scheme", () => {
    expect(resolveContrastingColorScheme("light")).toBe("dark");
  });

  test("returns light for a dark host color scheme", () => {
    expect(resolveContrastingColorScheme("dark")).toBe("light");
  });
});
