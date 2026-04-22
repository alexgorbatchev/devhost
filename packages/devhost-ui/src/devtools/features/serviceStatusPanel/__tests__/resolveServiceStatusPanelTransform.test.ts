import { describe, expect, test } from "bun:test";

import { resolveServiceStatusPanelTransform } from "../resolveServiceStatusPanelTransform";

describe("resolveServiceStatusPanelTransform", () => {
  test("keeps the panel fully visible while hovered", () => {
    expect(resolveServiceStatusPanelTransform(true, "40px")).toBe("translateX(0)");
  });

  test("tucks a right-docked panel behind the right edge while keeping a peek visible", () => {
    expect(resolveServiceStatusPanelTransform(false, "40px")).toBe("translateX(calc(100% - 40px))");
  });
});
