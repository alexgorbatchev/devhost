import type { JSX } from "preact";

import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../stackTypes";
import { selectVisibleServices } from "../selectVisibleServices";
import { DEVTOOLS_ROOT_ID } from "./constants";
import { DevtoolsLogMinimap } from "./DevtoolsLogMinimap";
import { getDevtoolsTheme, type IDevtoolsTheme } from "./devtoolsTheme";
import { readDevtoolsMinimapPosition } from "./readDevtoolsMinimapPosition";
import { readDevtoolsPosition } from "./readDevtoolsPosition";
import type { ServiceHealth } from "./types";
import { useResolvedColorScheme } from "./useResolvedColorScheme";
import { useServiceHealth } from "./useServiceHealth";
import { useServiceLogs } from "./useServiceLogs";

export function DevtoolsApp(): JSX.Element | null {
  const colorScheme = useResolvedColorScheme();
  const devtoolsTheme: IDevtoolsTheme = getDevtoolsTheme(colorScheme);
  const devtoolsPosition: DevtoolsPosition = readDevtoolsPosition();
  const devtoolsMinimapPosition: DevtoolsMinimapPosition = readDevtoolsMinimapPosition();
  const { errorMessage, services } = useServiceHealth();
  const visibleServices: ServiceHealth[] = selectVisibleServices(services);
  const logEntries = useServiceLogs();
  const shouldRenderPanel: boolean = errorMessage !== null || visibleServices.length > 0;
  const shouldRenderMinimap: boolean = logEntries.length > 0;

  if (!shouldRenderPanel && !shouldRenderMinimap) {
    return null;
  }

  return (
    <div id={DEVTOOLS_ROOT_ID} data-testid="DevtoolsApp">
      {shouldRenderPanel ? (
        <section
          aria-label="devhost services"
          style={createPanelStyle(devtoolsTheme, devtoolsPosition, devtoolsMinimapPosition, shouldRenderMinimap)}
        >
          {errorMessage !== null ? <div style={createErrorStyle(devtoolsTheme)}>{errorMessage}</div> : null}
          {visibleServices.length > 0 ? (
            <ul style={listStyle} data-testid="DevtoolsApp--service-list">
              {visibleServices.map((service: ServiceHealth) => {
                return (
                  <li key={service.name} style={rowStyle}>
                    <span aria-hidden="true" style={createStatusDotStyle(service.status, devtoolsTheme)} />
                    <span style={createNameStyle(devtoolsTheme)}>{service.name}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
      {shouldRenderMinimap ? (
        <DevtoolsLogMinimap
          entries={logEntries}
          minimapPosition={devtoolsMinimapPosition}
          theme={devtoolsTheme}
        />
      ) : null}
    </div>
  );
}

const listStyle: JSX.CSSProperties = {
  display: "grid",
  gap: "4px",
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const rowStyle: JSX.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
};

function createPanelStyle(
  devtoolsTheme: IDevtoolsTheme,
  devtoolsPosition: DevtoolsPosition,
  devtoolsMinimapPosition: DevtoolsMinimapPosition,
  hasVisibleMinimap: boolean,
): JSX.CSSProperties {
  const verticalPositionStyle: JSX.CSSProperties =
    devtoolsPosition === "top-left" || devtoolsPosition === "top-right"
      ? { top: devtoolsTheme.spacing.sm }
      : { bottom: devtoolsTheme.spacing.sm };
  const horizontalPositionStyle: JSX.CSSProperties = createHorizontalPositionStyle(
    devtoolsTheme,
    devtoolsPosition,
    devtoolsMinimapPosition,
    hasVisibleMinimap,
  );

  return {
    ...verticalPositionStyle,
    ...horizontalPositionStyle,
    position: "fixed",
    zIndex: devtoolsTheme.zIndices.floating,
    width: "fit-content",
    maxWidth: createPanelMaxWidth(devtoolsTheme, hasVisibleMinimap),
    padding: `${devtoolsTheme.spacing.xxs} ${devtoolsTheme.spacing.xs}`,
    border: `1px solid ${devtoolsTheme.colors.border}`,
    borderRadius: devtoolsTheme.radii.md,
    background: devtoolsTheme.colors.background,
    color: devtoolsTheme.colors.foreground,
    fontFamily: devtoolsTheme.fontFamilies.monospace,
    fontSize: devtoolsTheme.fontSizes.sm,
    boxShadow: devtoolsTheme.shadows.floating,
  };
}

function createPanelMaxWidth(devtoolsTheme: IDevtoolsTheme, hasVisibleMinimap: boolean): string {
  if (!hasVisibleMinimap) {
    return "calc(100vw - 20px)";
  }

  return `calc(100vw - 20px - ${devtoolsTheme.sizes.logMinimapPeekWidth} - ${devtoolsTheme.spacing.xxs})`;
}

function createHorizontalPositionStyle(
  devtoolsTheme: IDevtoolsTheme,
  devtoolsPosition: DevtoolsPosition,
  devtoolsMinimapPosition: DevtoolsMinimapPosition,
  hasVisibleMinimap: boolean,
): JSX.CSSProperties {
  const panelSide: DevtoolsMinimapPosition =
    devtoolsPosition === "top-left" || devtoolsPosition === "bottom-left" ? "left" : "right";
  const baseOffset: string = devtoolsTheme.spacing.sm;

  if (!hasVisibleMinimap || panelSide !== devtoolsMinimapPosition) {
    return panelSide === "left" ? { left: baseOffset } : { right: baseOffset };
  }

  const shiftedOffset: string =
    `calc(${baseOffset} + ${devtoolsTheme.sizes.logMinimapPeekWidth} + ${devtoolsTheme.spacing.xxs})`;

  return panelSide === "left" ? { left: shiftedOffset } : { right: shiftedOffset };
}

function createErrorStyle(devtoolsTheme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    marginBottom: "6px",
    color: devtoolsTheme.colors.dangerForeground,
    fontSize: devtoolsTheme.fontSizes.sm,
  };
}

function createNameStyle(devtoolsTheme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    color: devtoolsTheme.colors.foreground,
    fontSize: devtoolsTheme.fontSizes.sm,
  };
}

function createStatusDotStyle(isHealthy: boolean, devtoolsTheme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    width: "8px",
    height: "8px",
    flexShrink: 0,
    borderRadius: devtoolsTheme.radii.pill,
    background: isHealthy ? devtoolsTheme.colors.successBackground : devtoolsTheme.colors.dangerBackground,
    boxShadow: isHealthy
      ? `0 0 10px ${devtoolsTheme.colors.successGlow}, 0 0 4px ${devtoolsTheme.colors.successGlow}`
      : `0 0 10px ${devtoolsTheme.colors.dangerGlow}, 0 0 4px ${devtoolsTheme.colors.dangerGlow}`,
  };
}
