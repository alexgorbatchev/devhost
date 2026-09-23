import type { Terminal } from "@xterm/xterm";

import type { DevtoolsColorScheme } from "../../shared";
import { DEVTOOLS_FONT_FAMILY } from "../../shared/constants";

export interface ITerminalTheme {
  fontFamily: string;
  fontSize: number;
  theme: NonNullable<ConstructorParameters<typeof Terminal>[0]>["theme"];
}

// xterm renders to canvas/DOM from JavaScript options, so these values mirror the `--terminal`, `--foreground`,
// and `--primary` tokens in shared/devtools.css.
const sharedFontFamily: string = [
  `"${DEVTOOLS_FONT_FAMILY}"`,
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Consolas",
  '"Liberation Mono"',
  "monospace",
].join(", ");

export function readTerminalTheme(colorScheme: DevtoolsColorScheme): ITerminalTheme {
  if (colorScheme === "dark") {
    return {
      fontFamily: sharedFontFamily,
      fontSize: 13,
      theme: {
        background: "#0b0c0f",
        black: "#1c1f24",
        blue: "#6cb6ff",
        brightBlack: "#6f7783",
        brightBlue: "#96d0ff",
        brightCyan: "#7ee8fa",
        brightGreen: "#6ee7a8",
        brightMagenta: "#ff8ae2",
        brightRed: "#ff8a84",
        brightWhite: "#ffffff",
        brightYellow: "#ffd27a",
        cursor: "#ff5cd6",
        cursorAccent: "#0b0c0f",
        cyan: "#39d0e6",
        foreground: "#eceff3",
        green: "#3ddc84",
        magenta: "#ff5cd6",
        red: "#ff6159",
        selectionBackground: "#353b44",
        white: "#a3abb6",
        yellow: "#ffb224",
      },
    };
  }

  return {
    fontFamily: sharedFontFamily,
    fontSize: 13,
    theme: {
      background: "#ffffff",
      black: "#0c0e11",
      blue: "#0b5bd3",
      brightBlack: "#4b535e",
      brightBlue: "#1f6feb",
      brightCyan: "#0a8a9c",
      brightGreen: "#0d8f4a",
      brightMagenta: "#c52aa0",
      brightRed: "#e02d2d",
      brightWhite: "#7c8490",
      brightYellow: "#b86200",
      cursor: "#b8168c",
      cursorAccent: "#ffffff",
      cyan: "#087686",
      foreground: "#0c0e11",
      green: "#0a7d40",
      magenta: "#b8168c",
      red: "#cc1f1f",
      selectionBackground: "#e0e4ea",
      white: "#4b535e",
      yellow: "#a35400",
    },
  };
}
