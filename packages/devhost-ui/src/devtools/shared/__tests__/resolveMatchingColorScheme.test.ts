import { describe, expect, test } from "bun:test";

import { resolveMatchingColorScheme } from "../resolveMatchingColorScheme";

describe("resolveMatchingColorScheme", () => {
  test("returns light for a light host color scheme", () => {
    expect(resolveMatchingColorScheme("light")).toBe("light");
  });

  test("returns dark for a dark host color scheme", () => {
    expect(resolveMatchingColorScheme("dark")).toBe("dark");
  });
});
