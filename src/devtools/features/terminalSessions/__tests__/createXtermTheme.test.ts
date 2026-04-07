import { describe, expect, test } from "bun:test";

import { getDevtoolsTheme } from "../../../shared/devtoolsTheme";
import { createXtermTheme } from "../createXtermTheme";

describe("createXtermTheme", () => {
  test("uses the Tokyo Night storm ansi palette for the dark theme", () => {
    expect(createXtermTheme(getDevtoolsTheme("dark"))).toMatchObject({
      background: "#24283b",
      black: "#1d202f",
      blue: "#7aa2f7",
      brightBlack: "#414868",
      brightBlue: "#8db0ff",
      brightCyan: "#a4daff",
      brightGreen: "#9fe044",
      brightMagenta: "#c7a9ff",
      brightRed: "#ff899d",
      brightWhite: "#c0caf5",
      brightYellow: "#faba4a",
      cursor: "#7aa2f7",
      cursorAccent: "#11121a",
      cyan: "#7dcfff",
      foreground: "#c0caf5",
      green: "#9ece6a",
      magenta: "#bb9af7",
      red: "#f7768e",
      selectionBackground: "#2e3c64",
      white: "#a9b1d6",
      yellow: "#e0af68",
    });
  });

  test("uses the Tokyo Night day ansi palette for the light theme", () => {
    expect(createXtermTheme(getDevtoolsTheme("light"))).toMatchObject({
      background: "#e1e2e7",
      black: "#b4b5b9",
      blue: "#2e7de9",
      brightBlack: "#a1a6c5",
      brightBlue: "#358aff",
      brightCyan: "#007ea8",
      brightGreen: "#5c8524",
      brightMagenta: "#a463ff",
      brightRed: "#ff4774",
      brightWhite: "#3760bf",
      brightYellow: "#a27629",
      cursor: "#2e7de9",
      cursorAccent: "#11121a",
      cyan: "#007197",
      foreground: "#3760bf",
      green: "#587539",
      magenta: "#9854f1",
      red: "#f52a65",
      selectionBackground: "#b7c1e3",
      white: "#6172b0",
      yellow: "#8c6c3e",
    });
  });
});
