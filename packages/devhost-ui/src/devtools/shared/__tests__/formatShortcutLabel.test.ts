import { describe, expect, test } from "bun:test";

import { formatShortcutLabel } from "../formatShortcutLabel";

describe("formatShortcutLabel", () => {
  test("capitalizes modifiers and upper-cases single-character keys", () => {
    expect(formatShortcutLabel("alt+ctrl+r")).toBe("Alt+Ctrl+R");
  });

  test("normalizes the cmd alias and mixed casing", () => {
    expect(formatShortcutLabel("CMD+Shift+x")).toBe("Meta+Shift+X");
  });

  test("keeps named keys readable", () => {
    expect(formatShortcutLabel("ctrl+enter")).toBe("Ctrl+Enter");
  });
});
