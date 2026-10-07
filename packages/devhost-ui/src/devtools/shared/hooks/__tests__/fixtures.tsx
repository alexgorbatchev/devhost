import type { ComponentType, PropsWithChildren } from "react";

import { ColorSchemeProvider } from "../../components/ColorSchemeProvider";
import { ToolbarPopover } from "../../components/ToolbarPopover";
import type { DevtoolsColorScheme } from "../../DevtoolsColorScheme";

/** A `renderHook` wrapper that provides `colorScheme` the way the devtools root does. */
export function factory_colorSchemeWrapper(colorScheme: DevtoolsColorScheme): ComponentType<PropsWithChildren> {
  return function ColorSchemeWrapper({ children }: PropsWithChildren) {
    return <ColorSchemeProvider colorScheme={colorScheme}>{children}</ColorSchemeProvider>;
  };
}

/** A `renderHook` wrapper that renders the hook as the content of a toolbar popover panel. */
export function factory_toolbarPanelWrapper(): ComponentType<PropsWithChildren> {
  return function ToolbarPanelWrapper({ children }: PropsWithChildren) {
    return (
      <ToolbarPopover
        panelLabel="Sessions"
        panelWidth="sm"
        testId="Sessions"
        triggerContent="Sessions"
        triggerLabel="Show sessions"
      >
        {children}
      </ToolbarPopover>
    );
  };
}
