import { describe, expect, test } from "bun:test";

import { resolveServiceStatusPanelTransform } from "../devtools/features/serviceStatusPanel/resolveServiceStatusPanelTransform";

describe("resolveServiceStatusPanelTransform", () => {
  test("keeps the panel fully visible while hovered", () => {
    expect(resolveServiceStatusPanelTransform("left", true, "40px")).toBe("translateX(0)");
    expect(resolveServiceStatusPanelTransform("right", true, "40px")).toBe("translateX(0)");
  });

  test("tucks a left-docked panel behind the left edge while keeping a peek visible", () => {
    expect(resolveServiceStatusPanelTransform("left", false, "40px")).toBe("translateX(calc(-100% + 40px))");
  });

  test("tucks a right-docked panel behind the right edge while keeping a peek visible", () => {
    expect(resolveServiceStatusPanelTransform("right", false, "40px")).toBe("translateX(calc(100% - 40px))");
  });
});
