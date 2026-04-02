import type { JSX } from "preact";
import { useState } from "preact/hooks";

import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../stackTypes";
import { DevtoolsAnnotationComposer } from "./features/annotationComposer";
import { DevtoolsLogMinimap, useServiceLogs } from "./features/minimap";
import { DevtoolsServiceStatusPanel, useServiceHealth } from "./features/serviceStatusPanel";
import {
  createCornerDockStyle,
  DEVTOOLS_ROOT_ID,
  getDevtoolsTheme,
  type IDevtoolsTheme,
  readDevtoolsMinimapPosition,
  readDevtoolsPosition,
  readDevtoolsStackName,
  useResolvedColorScheme,
} from "./shared";

export function DevtoolsApp(): JSX.Element | null {
  const colorScheme = useResolvedColorScheme();
  const devtoolsTheme: IDevtoolsTheme = getDevtoolsTheme(colorScheme);
  const devtoolsPosition: DevtoolsPosition = readDevtoolsPosition();
  const devtoolsMinimapPosition: DevtoolsMinimapPosition = readDevtoolsMinimapPosition();
  const stackName: string = readDevtoolsStackName();
  const { errorMessage, services } = useServiceHealth();
  const [isMinimapHovered, setIsMinimapHovered] = useState<boolean>(false);
  const logEntries = useServiceLogs(isMinimapHovered);
  const shouldRenderPanel: boolean = errorMessage !== null || services.length > 0;
  const shouldRenderMinimap: boolean = logEntries.length > 0;
  const shouldRenderButtonFirst: boolean =
    devtoolsPosition === "top-left" || devtoolsPosition === "top-right";

  return (
    <div id={DEVTOOLS_ROOT_ID} data-devhost-devtools="" data-testid="DevtoolsApp">
      <div
        data-testid="DevtoolsApp--corner-dock"
        style={createCornerDockStyle(devtoolsTheme, {
          devtoolsMinimapPosition: devtoolsMinimapPosition,
          devtoolsPosition,
          hasVisibleMinimap: shouldRenderMinimap,
        })}
      >
        {shouldRenderButtonFirst ? (
          <DevtoolsAnnotationComposer stackName={stackName} theme={devtoolsTheme} />
        ) : null}
        {shouldRenderPanel ? <DevtoolsServiceStatusPanel errorMessage={errorMessage} services={services} theme={devtoolsTheme} /> : null}
        {shouldRenderButtonFirst ? null : <DevtoolsAnnotationComposer stackName={stackName} theme={devtoolsTheme} />}
      </div>
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
