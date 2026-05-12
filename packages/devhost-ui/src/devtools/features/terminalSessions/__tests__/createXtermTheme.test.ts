import { describe, expect, test } from "bun:test";

import { getDevtoolsTheme } from "../../../shared/devtoolsTheme";
import { createXtermTheme } from "../createXtermTheme";

describe("createXtermTheme", () => {
  test("uses the Catppuccin Frappé dark surface with readable ansi accents", () => {
    expect(createXtermTheme(getDevtoolsTheme("dark"))).toMatchObject({
      background: "hsl(229 18.644% 23.137%)",
      black: "hsl(229 18.644% 23.137%)",
      blue: "hsl(222 74.242% 74.118%)",
      brightBlack: "hsl(227 43.689% 79.804%)",
      brightBlue: "hsl(222 74.242% 74.118%)",
      brightCyan: "hsl(172 39.227% 64.51%)",
      brightGreen: "hsl(96 43.902% 67.843%)",
      brightMagenta: "hsl(277 59.016% 76.078%)",
      brightRed: "hsl(359 67.785% 70.784%)",
      brightWhite: "hsl(227 70.149% 86.863%)",
      brightYellow: "hsl(40 62.044% 73.137%)",
      cursor: "hsl(277 59.016% 76.078%)",
      cursorAccent: "hsl(229 18.644% 23.137%)",
      cyan: "hsl(172 39.227% 64.51%)",
      foreground: "hsl(227 70.149% 86.863%)",
      green: "hsl(96 43.902% 67.843%)",
      magenta: "hsl(277 59.016% 76.078%)",
      red: "hsl(359 67.785% 70.784%)",
      selectionBackground: "hsl(230 15.584% 30.196%)",
      white: "hsl(227 43.689% 79.804%)",
      yellow: "hsl(40 62.044% 73.137%)",
    });
  });

  test("uses the Catppuccin Latte light surface with readable ansi accents", () => {
    expect(createXtermTheme(getDevtoolsTheme("light"))).toMatchObject({
      background: "hsl(220 23.077% 94.902%)",
      black: "hsl(234 16.022% 35.49%)",
      blue: "hsl(220 91.489% 53.922%)",
      brightBlack: "hsl(233 12.796% 41.373%)",
      brightBlue: "hsl(220 91.489% 53.922%)",
      brightCyan: "hsl(183 73.864% 34.51%)",
      brightGreen: "hsl(109 57.635% 39.804%)",
      brightMagenta: "hsl(266 85.047% 58.039%)",
      brightRed: "hsl(347 86.667% 44.118%)",
      brightWhite: "hsl(220 23.077% 94.902%)",
      brightYellow: "hsl(35 76.984% 49.412%)",
      cursor: "hsl(266 85.047% 58.039%)",
      cursorAccent: "hsl(220 23.077% 94.902%)",
      cyan: "hsl(183 73.864% 34.51%)",
      foreground: "hsl(234 16.022% 35.49%)",
      green: "hsl(109 57.635% 39.804%)",
      magenta: "hsl(266 85.047% 58.039%)",
      red: "hsl(347 86.667% 44.118%)",
      selectionBackground: "hsl(223 15.909% 82.745%)",
      white: "hsl(233 12.796% 41.373%)",
      yellow: "hsl(35 76.984% 49.412%)",
    });
  });
});
