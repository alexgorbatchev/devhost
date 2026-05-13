import type { DevtoolsColorScheme } from "../../shared";

export interface ILogMinimapPalette {
  stderr: string;
  stdout: string;
}

export function readLogMinimapPalette(colorScheme: DevtoolsColorScheme): ILogMinimapPalette {
  if (colorScheme === "dark") {
    return {
      stderr: "hsl(359 67.785% 70.784% / 90%)",
      stdout: "hsl(227 70.149% 86.863% / 14%)",
    };
  }

  return {
    stderr: "hsl(347 86.667% 44.118% / 88%)",
    stdout: "hsl(234 16.022% 35.49% / 16%)",
  };
}
