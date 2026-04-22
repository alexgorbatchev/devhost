import type { ReactNode, JSX } from "react";
import { useMemo } from "react";

import { devtoolsThemeContext } from "./devtoolsThemeContext";
import { getDevtoolsTheme, type DevtoolsColorScheme, type IDevtoolsTheme } from "./devtoolsTheme";

interface IThemeProviderProps {
  children: ReactNode;
  colorScheme: DevtoolsColorScheme;
}

export function ThemeProvider(props: IThemeProviderProps): JSX.Element {
  const theme: IDevtoolsTheme = useMemo((): IDevtoolsTheme => {
    return getDevtoolsTheme(props.colorScheme);
  }, [props.colorScheme]);

  return <devtoolsThemeContext.Provider value={theme}>{props.children}</devtoolsThemeContext.Provider>;
}
