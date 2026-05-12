import { describe, expect, it } from "bun:test";

import {
  readStorybookDevtoolsColorScheme,
  readStorybookPreviewTheme,
  storybookDevtoolsThemeGlobalName,
} from "../storybookTheme";

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

describe("readStorybookPreviewTheme", () => {
  it("returns the light preview theme colors", () => {
    expect(readStorybookPreviewTheme("light")).toEqual({
      backgroundColor: "hsl(220 23.077% 94.902%)",
      color: "hsl(234 16.022% 35.49%)",
      colorScheme: "light",
    });
  });

  it("returns the dark preview theme colors", () => {
    expect(readStorybookPreviewTheme("dark")).toEqual({
      backgroundColor: "hsl(229 18.644% 23.137%)",
      color: "hsl(227 70.149% 86.863%)",
      colorScheme: "dark",
    });
  });
});
