import type { JSX, ReactNode } from "react";

import { ColorSchemeProvider, type DevtoolsColorScheme } from "..";
import { storybookDevtoolsThemeGlobalName } from "./storybookThemeGlobals";

export { storybookDevtoolsThemeGlobalName };

export interface IStorybookPreviewTheme {
  backgroundColor: string;
  color: string;
  colorScheme: DevtoolsColorScheme;
}

interface IStorybookThemeProviderProps {
  children: ReactNode;
  globals: Partial<Record<string, unknown>>;
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

export function StorybookThemeProvider(props: IStorybookThemeProviderProps): JSX.Element {
  const colorScheme: DevtoolsColorScheme = readStorybookDevtoolsColorScheme(props.globals);

  return (
    <ColorSchemeProvider colorScheme={colorScheme}>
      <div className="contents" data-devhost-story-theme="" data-theme={colorScheme}>
        {props.children}
      </div>
    </ColorSchemeProvider>
  );
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
