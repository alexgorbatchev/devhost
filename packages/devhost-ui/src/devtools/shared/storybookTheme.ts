import type { DevtoolsColorScheme } from "./DevtoolsColorScheme";

export const storybookDevtoolsThemeGlobalName: string = "devhostTheme";

export interface IStorybookPreviewTheme {
  backgroundColor: string;
  color: string;
  colorScheme: DevtoolsColorScheme;
}

export function readStorybookDevtoolsColorScheme(globals: Partial<Record<string, unknown>>): DevtoolsColorScheme {
  const value: unknown = globals[storybookDevtoolsThemeGlobalName];

  if (value === "light" || value === "dark") {
    return value;
  }

  return "dark";
}

export function readStorybookPreviewTheme(colorScheme: DevtoolsColorScheme): IStorybookPreviewTheme {
  return colorScheme === "dark" ? darkStorybookPreviewTheme : lightStorybookPreviewTheme;
}

const darkStorybookPreviewTheme: IStorybookPreviewTheme = {
  backgroundColor: "hsl(229 18.644% 23.137%)",
  color: "hsl(227 70.149% 86.863%)",
  colorScheme: "dark",
};
const lightStorybookPreviewTheme: IStorybookPreviewTheme = {
  backgroundColor: "hsl(220 23.077% 94.902%)",
  color: "hsl(234 16.022% 35.49%)",
  colorScheme: "light",
};
