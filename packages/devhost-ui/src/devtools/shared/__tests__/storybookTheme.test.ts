import { describe, expect, it } from "bun:test";

import { readStorybookDevtoolsColorScheme, storybookDevtoolsThemeGlobalName } from "../storybookTheme";

describe("readStorybookDevtoolsColorScheme", () => {
  it("reads a light theme global", () => {
    expect(readStorybookDevtoolsColorScheme({ [storybookDevtoolsThemeGlobalName]: "light" })).toBe("light");
  });

  it("reads a dark theme global", () => {
    expect(readStorybookDevtoolsColorScheme({ [storybookDevtoolsThemeGlobalName]: "dark" })).toBe("dark");
  });

  it("defaults unknown theme globals to dark", () => {
    expect(readStorybookDevtoolsColorScheme({ [storybookDevtoolsThemeGlobalName]: "system" })).toBe("dark");
  });
});
