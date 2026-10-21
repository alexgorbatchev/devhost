import { describe, expect, test } from "bun:test";

import { readSaveShortcutLabel } from "../readSaveShortcutLabel";

describe("readSaveShortcutLabel", () => {
  test.each([
    ["MacIntel", "Meta+S"],
    ["iPhone", "Meta+S"],
    ["Linux x86_64", "Ctrl+S"],
    ["Win32", "Ctrl+S"],
  ])("labels the save shortcut on %s as %s", (platform, expected) => {
    expect(readSaveShortcutLabel(platform)).toBe(expected);
  });
});
