import { useContext } from "react";

import { devtoolsThemeContext } from "./devtoolsThemeContext";
import { getDevtoolsTheme, type IDevtoolsTheme } from "./devtoolsTheme";

export function useDevtoolsTheme(): IDevtoolsTheme {
  const colorScheme = useContext(devtoolsThemeContext);

  if (colorScheme === null) {
    throw new Error("Devtools theme is unavailable outside ThemeProvider.");
  }

  return getDevtoolsTheme(colorScheme);
}
