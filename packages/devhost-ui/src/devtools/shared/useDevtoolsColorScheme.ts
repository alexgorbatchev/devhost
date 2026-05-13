import { useContext } from "react";

import type { DevtoolsColorScheme } from "./DevtoolsColorScheme";
import { devtoolsColorSchemeContext } from "./devtoolsColorSchemeContext";

export function useDevtoolsColorScheme(): DevtoolsColorScheme {
  const colorScheme: DevtoolsColorScheme | null = useContext(devtoolsColorSchemeContext);

  if (colorScheme === null) {
    throw new Error("Devtools color scheme is unavailable outside ColorSchemeProvider.");
  }

  return colorScheme;
}
