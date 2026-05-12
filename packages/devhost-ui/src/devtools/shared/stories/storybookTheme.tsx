import type { JSX, ReactNode } from "react";

import { type DevtoolsColorScheme, getDevtoolsTheme } from "../devtoolsTheme";
import { ThemeProvider } from "../ThemeProvider";
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
  const theme = getDevtoolsTheme(colorScheme);

  return {
    backgroundColor: theme.colors.background,
    color: theme.colors.foreground,
    colorScheme,
  };
}

export function StorybookThemeProvider(props: IStorybookThemeProviderProps): JSX.Element {
  return <ThemeProvider colorScheme={readStorybookDevtoolsColorScheme(props.globals)}>{props.children}</ThemeProvider>;
}
