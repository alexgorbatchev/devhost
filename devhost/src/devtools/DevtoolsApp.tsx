import type { JSX } from "preact";
import { useState } from "preact/hooks";

import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../stackTypes";
import { DevtoolsLogMinimap, useServiceLogs } from "./features/minimap";
import { DevtoolsServiceStatusPanel, useServiceHealth } from "./features/serviceStatusPanel";
import {
  DEVTOOLS_ROOT_ID,
  getDevtoolsTheme,
  type IDevtoolsTheme,
  readDevtoolsMinimapPosition,
  readDevtoolsPosition,
  useResolvedColorScheme,
} from "./shared";

export function DevtoolsApp(): JSX.Element | null {
  const colorScheme = useResolvedColorScheme();
  const devtoolsTheme: IDevtoolsTheme = getDevtoolsTheme(colorScheme);
  const devtoolsPosition: DevtoolsPosition = readDevtoolsPosition();
  const devtoolsMinimapPosition: DevtoolsMinimapPosition = readDevtoolsMinimapPosition();
  const { errorMessage, services } = useServiceHealth();
  const [isMinimapHovered, setIsMinimapHovered] = useState<boolean>(false);
  const logEntries = useServiceLogs(isMinimapHovered);
  const shouldRenderPanel: boolean = errorMessage !== null || services.length > 0;
  const shouldRenderMinimap: boolean = logEntries.length > 0;

  if (!shouldRenderPanel && !shouldRenderMinimap) {
    return null;
  }

  return (
    <div id={DEVTOOLS_ROOT_ID} data-testid="DevtoolsApp">
      {shouldRenderPanel ? (
        <DevtoolsServiceStatusPanel
          devtoolsMinimapPosition={devtoolsMinimapPosition}
          devtoolsPosition={devtoolsPosition}
          errorMessage={errorMessage}
          hasVisibleMinimap={shouldRenderMinimap}
          services={services}
          theme={devtoolsTheme}
        />
      ) : null}
      {shouldRenderMinimap ? (
        <DevtoolsLogMinimap
          entries={logEntries}
          isHovered={isMinimapHovered}
          minimapPosition={devtoolsMinimapPosition}
          onHoveredChange={setIsMinimapHovered}
          theme={devtoolsTheme}
        />
      ) : null}
    </div>
  );
}
