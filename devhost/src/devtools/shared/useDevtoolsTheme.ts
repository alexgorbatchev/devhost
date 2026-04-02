import { useContext } from "preact/hooks";

import { devtoolsThemeContext } from "./devtoolsThemeContext";
import type { IDevtoolsTheme } from "./devtoolsTheme";

export function useDevtoolsTheme(): IDevtoolsTheme {
  const theme: IDevtoolsTheme | null = useContext(devtoolsThemeContext);

  if (theme === null) {
    throw new Error("Devtools theme is unavailable outside ThemeProvider.");
  }

  return theme;
}
