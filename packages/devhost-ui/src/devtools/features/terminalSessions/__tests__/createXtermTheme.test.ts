import { describe, expect, test } from "bun:test";

import { getDevtoolsTheme } from "../../../shared/devtoolsTheme";
import { createXtermTheme } from "../createXtermTheme";

describe("createXtermTheme", () => {
  test("uses the default shadcn neutral dark surface with readable ansi accents", () => {
    expect(createXtermTheme(getDevtoolsTheme("dark"))).toMatchObject({
      background: "oklch(0.145 0 0)",
      black: "oklch(0.205 0 0)",
      blue: "oklch(0.488 0.243 264.376)",
      brightBlack: "oklch(0.708 0 0)",
      brightBlue: "oklch(0.627 0.265 303.9)",
      brightCyan: "oklch(0.696 0.17 162.48)",
      brightGreen: "oklch(0.696 0.17 162.48)",
      brightMagenta: "oklch(0.627 0.265 303.9)",
      brightRed: "oklch(0.704 0.191 22.216)",
      brightWhite: "oklch(0.985 0 0)",
      brightYellow: "oklch(0.769 0.188 70.08)",
      cursor: "oklch(0.922 0 0)",
      cursorAccent: "oklch(0.205 0 0)",
      cyan: "oklch(0.696 0.17 162.48)",
      foreground: "oklch(0.985 0 0)",
      green: "oklch(0.696 0.17 162.48)",
      magenta: "oklch(0.627 0.265 303.9)",
      red: "oklch(0.704 0.191 22.216)",
      selectionBackground: "oklch(0.269 0 0)",
      white: "oklch(0.708 0 0)",
      yellow: "oklch(0.769 0.188 70.08)",
    });
  });

  test("uses the default shadcn neutral light surface with readable ansi accents", () => {
    expect(createXtermTheme(getDevtoolsTheme("light"))).toMatchObject({
      background: "oklch(1 0 0)",
      black: "oklch(0.145 0 0)",
      blue: "oklch(0.646 0.222 41.116)",
      brightBlack: "oklch(0.556 0 0)",
      brightBlue: "oklch(0.398 0.07 227.392)",
      brightCyan: "oklch(0.6 0.118 184.704)",
      brightGreen: "oklch(0.6 0.118 184.704)",
      brightMagenta: "oklch(0.828 0.189 84.429)",
      brightRed: "oklch(0.577 0.245 27.325)",
      brightWhite: "oklch(0.985 0 0)",
      brightYellow: "oklch(0.769 0.188 70.08)",
      cursor: "oklch(0.205 0 0)",
      cursorAccent: "oklch(0.985 0 0)",
      cyan: "oklch(0.6 0.118 184.704)",
      foreground: "oklch(0.145 0 0)",
      green: "oklch(0.6 0.118 184.704)",
      magenta: "oklch(0.828 0.189 84.429)",
      red: "oklch(0.577 0.245 27.325)",
      selectionBackground: "oklch(0.97 0 0)",
      white: "oklch(0.556 0 0)",
      yellow: "oklch(0.769 0.188 70.08)",
    });
  });
});
