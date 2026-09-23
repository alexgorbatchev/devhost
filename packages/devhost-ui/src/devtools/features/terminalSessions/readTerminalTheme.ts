import { TERMINAL_PALETTES } from "@alexgorbatchev/devhost-design";
import type { Terminal } from "@xterm/xterm";

import type { DevtoolsColorScheme } from "../../shared";
import { DEVTOOLS_FONT_FAMILY } from "../../shared/constants";

export interface ITerminalTheme {
  fontFamily: string;
  fontSize: number;
  theme: NonNullable<ConstructorParameters<typeof Terminal>[0]>["theme"];
}

const sharedFontFamily: string = [
  `"${DEVTOOLS_FONT_FAMILY}"`,
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Consolas",
  '"Liberation Mono"',
  "monospace",
].join(", ");

// xterm renders to canvas/DOM from JavaScript options rather than CSS, so it takes the literal terminal palette
// from the shared design tokens instead of the `--dh-*` custom properties.
export function readTerminalTheme(colorScheme: DevtoolsColorScheme): ITerminalTheme {
  return {
    fontFamily: sharedFontFamily,
    fontSize: 13,
    theme: TERMINAL_PALETTES[colorScheme],
  };
}
