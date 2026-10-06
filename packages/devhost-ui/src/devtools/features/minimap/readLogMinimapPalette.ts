import { DESIGN_TOKENS } from "@alexgorbatchev/devhost-design";

import type { DevtoolsColorScheme } from "../../shared";

export interface ILogMinimapPalette {
  stderr: string;
  stdout: string;
}

// Canvas requires literal colors, so read the same shared palette that supplies its surrounding CSS.
export function readLogMinimapPalette(colorScheme: DevtoolsColorScheme): ILogMinimapPalette {
  const palette = DESIGN_TOKENS.schemes[colorScheme];
  return {
    stderr: palette.danger,
    stdout: palette.fgFaint,
  };
}
