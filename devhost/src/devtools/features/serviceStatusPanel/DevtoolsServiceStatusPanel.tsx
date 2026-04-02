import type { JSX } from "preact";

import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../../../stackTypes";
import type { IDevtoolsTheme } from "../../shared";
import type { ServiceHealth } from "../../shared/types";
import { selectVisibleServices } from "./selectVisibleServices";

interface IDevtoolsServiceStatusPanelProps {
  devtoolsMinimapPosition: DevtoolsMinimapPosition;
  devtoolsPosition: DevtoolsPosition;
  errorMessage: string | null;
  hasVisibleMinimap: boolean;
  services: ServiceHealth[];
  theme: IDevtoolsTheme;
}

export function DevtoolsServiceStatusPanel(props: IDevtoolsServiceStatusPanelProps): JSX.Element | null {
  const visibleServices: ServiceHealth[] = selectVisibleServices(props.services);
  const shouldRenderPanel: boolean = props.errorMessage !== null || visibleServices.length > 0;

  if (!shouldRenderPanel) {
    return null;
  }

  return (
    <section
      aria-label="devhost services"
      data-testid="DevtoolsServiceStatusPanel"
      style={createPanelStyle(
        props.theme,
        props.devtoolsPosition,
        props.devtoolsMinimapPosition,
        props.hasVisibleMinimap,
      )}
    >
      {props.errorMessage !== null ? <div style={createErrorStyle(props.theme)}>{props.errorMessage}</div> : null}
      {visibleServices.length > 0 ? (
        <ul style={listStyle} data-testid="DevtoolsServiceStatusPanel--service-list">
          {visibleServices.map((service: ServiceHealth) => {
            return (
              <li key={service.name} style={rowStyle}>
                <span aria-hidden="true" style={createStatusDotStyle(service.status, props.theme)} />
                <span style={createNameStyle(props.theme)}>{service.name}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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
  theme: IDevtoolsTheme,
  devtoolsPosition: DevtoolsPosition,
  devtoolsMinimapPosition: DevtoolsMinimapPosition,
  hasVisibleMinimap: boolean,
): JSX.CSSProperties {
  const verticalPositionStyle: JSX.CSSProperties =
    devtoolsPosition === "top-left" || devtoolsPosition === "top-right"
      ? { top: theme.spacing.sm }
      : { bottom: theme.spacing.sm };
  const horizontalPositionStyle: JSX.CSSProperties = createHorizontalPositionStyle(
    theme,
    devtoolsPosition,
    devtoolsMinimapPosition,
    hasVisibleMinimap,
  );

  return {
    ...verticalPositionStyle,
    ...horizontalPositionStyle,
    position: "fixed",
    zIndex: theme.zIndices.floating,
    width: "fit-content",
    maxWidth: createPanelMaxWidth(theme, hasVisibleMinimap),
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    background: theme.colors.background,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    boxShadow: theme.shadows.floating,
  };
}

function createPanelMaxWidth(theme: IDevtoolsTheme, hasVisibleMinimap: boolean): string {
  if (!hasVisibleMinimap) {
    return "calc(100vw - 20px)";
  }

  return `calc(100vw - 20px - ${theme.sizes.logMinimapPeekWidth} - ${theme.spacing.xxs})`;
}

function createHorizontalPositionStyle(
  theme: IDevtoolsTheme,
  devtoolsPosition: DevtoolsPosition,
  devtoolsMinimapPosition: DevtoolsMinimapPosition,
  hasVisibleMinimap: boolean,
): JSX.CSSProperties {
  const panelSide: DevtoolsMinimapPosition =
    devtoolsPosition === "top-left" || devtoolsPosition === "bottom-left" ? "left" : "right";
  const baseOffset: string = theme.spacing.sm;

  if (!hasVisibleMinimap || panelSide !== devtoolsMinimapPosition) {
    return panelSide === "left" ? { left: baseOffset } : { right: baseOffset };
  }

  const shiftedOffset: string =
    `calc(${baseOffset} + ${theme.sizes.logMinimapPeekWidth} + ${theme.spacing.xxs})`;

  return panelSide === "left" ? { left: shiftedOffset } : { right: shiftedOffset };
}

function createErrorStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    marginBottom: "6px",
    color: theme.colors.dangerForeground,
    fontSize: theme.fontSizes.sm,
  };
}

function createNameStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    color: theme.colors.foreground,
    fontSize: theme.fontSizes.sm,
  };
}

function createStatusDotStyle(isHealthy: boolean, theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    width: "8px",
    height: "8px",
    flexShrink: 0,
    borderRadius: theme.radii.pill,
    background: isHealthy ? theme.colors.successBackground : theme.colors.dangerBackground,
    boxShadow: isHealthy
      ? `0 0 10px ${theme.colors.successGlow}, 0 0 4px ${theme.colors.successGlow}`
      : `0 0 10px ${theme.colors.dangerGlow}, 0 0 4px ${theme.colors.dangerGlow}`,
  };
}
