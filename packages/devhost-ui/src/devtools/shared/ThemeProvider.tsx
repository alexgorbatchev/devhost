import type { ReactNode, JSX } from "react";

import { type DevtoolsColorScheme } from "./devtoolsTheme";

import { devtoolsThemeContext } from "./devtoolsThemeContext";

interface IThemeProviderProps {
  children: ReactNode;
  colorScheme: DevtoolsColorScheme;
}

export function ThemeProvider(props: IThemeProviderProps): JSX.Element {
  return (
    <devtoolsThemeContext.Provider value={props.colorScheme}>
      <div className={props.colorScheme === "dark" ? "devhost-theme dark" : "devhost-theme"}>{props.children}</div>
    </devtoolsThemeContext.Provider>
  );
}
