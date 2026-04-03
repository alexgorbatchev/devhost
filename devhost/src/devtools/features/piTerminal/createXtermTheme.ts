import type { Terminal } from "@xterm/xterm";

import type { IDevtoolsTheme } from "../../shared";

export function createXtermTheme(
  theme: IDevtoolsTheme,
): NonNullable<ConstructorParameters<typeof Terminal>[0]>["theme"] {
  return {
    background: theme.colors.background,
    black: theme.terminal.black,
    blue: theme.terminal.blue,
    brightBlack: theme.terminal.brightBlack,
    brightBlue: theme.terminal.brightBlue,
    brightCyan: theme.terminal.brightCyan,
    brightGreen: theme.terminal.brightGreen,
    brightMagenta: theme.terminal.brightMagenta,
    brightRed: theme.terminal.brightRed,
    brightWhite: theme.terminal.brightWhite,
    brightYellow: theme.terminal.brightYellow,
    cursor: theme.colors.accentBackground,
    cursorAccent: theme.colors.accentForeground,
    cyan: theme.terminal.cyan,
    foreground: theme.colors.foreground,
    green: theme.terminal.green,
    magenta: theme.terminal.magenta,
    red: theme.terminal.red,
    selectionBackground: theme.colors.selectionBackground,
    white: theme.terminal.white,
    yellow: theme.terminal.yellow,
  };
}
