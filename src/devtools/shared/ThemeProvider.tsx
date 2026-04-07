import type { ComponentChildren, JSX } from "preact";
import { useMemo } from "preact/hooks";

import { devtoolsThemeContext } from "./devtoolsThemeContext";
import { getDevtoolsTheme, type DevtoolsColorScheme, type IDevtoolsTheme } from "./devtoolsTheme";

interface IThemeProviderProps {
  children: ComponentChildren;
  colorScheme: DevtoolsColorScheme;
}

export function ThemeProvider(props: IThemeProviderProps): JSX.Element {
  const theme: IDevtoolsTheme = useMemo((): IDevtoolsTheme => {
    return getDevtoolsTheme(props.colorScheme);
  }, [props.colorScheme]);

  return <devtoolsThemeContext.Provider value={theme}>{props.children}</devtoolsThemeContext.Provider>;
}
