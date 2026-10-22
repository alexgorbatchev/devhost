import type { ComponentType, PropsWithChildren } from "react";

import { ColorSchemeProvider } from "../../components/ColorSchemeProvider";
import type { DevtoolsColorScheme } from "../../DevtoolsColorScheme";

/** A `renderHook` wrapper that provides `colorScheme` the way the devtools root does. */
export function factory_colorSchemeWrapper(colorScheme: DevtoolsColorScheme): ComponentType<PropsWithChildren> {
  return function ColorSchemeWrapper({ children }: PropsWithChildren) {
    return <ColorSchemeProvider colorScheme={colorScheme}>{children}</ColorSchemeProvider>;
  };
}
