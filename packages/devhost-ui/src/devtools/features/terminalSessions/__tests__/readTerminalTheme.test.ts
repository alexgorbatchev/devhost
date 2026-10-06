import { describe, expect, it } from "bun:test";

import { readTerminalTheme } from "../readTerminalTheme";

describe("readTerminalTheme", () => {
  it.each(["dark", "light"] as const)("enables native text contrast adjustment in the %s terminal", (scheme) => {
    const options = readTerminalTheme(scheme);
    expect(options).toHaveProperty("minimumContrastRatio", 4.5);
  });
});
