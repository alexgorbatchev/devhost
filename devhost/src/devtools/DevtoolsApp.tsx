import type { JSX } from "preact";

import { DEVTOOLS_ROOT_ID } from "./constants";
import { getDevtoolsTheme, type IDevtoolsTheme } from "./devtoolsTheme";
import type { ServiceHealth } from "./types";
import { useResolvedColorScheme } from "./useResolvedColorScheme";
import { useServiceHealth } from "./useServiceHealth";

export function DevtoolsApp(): JSX.Element | null {
  const colorScheme = useResolvedColorScheme();
  const devtoolsTheme: IDevtoolsTheme = getDevtoolsTheme(colorScheme);
  const { errorMessage, services } = useServiceHealth();

  if (errorMessage === null && services.length === 0) {
    return null;
  }

  return (
    <section
      id={DEVTOOLS_ROOT_ID}
      aria-label="devhost services"
      style={createPanelStyle(devtoolsTheme)}
      data-testid="DevtoolsApp"
    >
      {errorMessage !== null ? <div style={createErrorStyle(devtoolsTheme)}>{errorMessage}</div> : null}
      {services.length > 0 ? (
        <ul style={listStyle} data-testid="DevtoolsApp--service-list">
          {services.map((service: ServiceHealth) => {
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

function createPanelStyle(devtoolsTheme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    position: "fixed",
    right: devtoolsTheme.spacing.lg,
    bottom: devtoolsTheme.spacing.lg,
    zIndex: devtoolsTheme.zIndices.floating,
    width: "fit-content",
    maxWidth: "calc(100vw - 32px)",
    padding: devtoolsTheme.spacing.sm,
    border: `1px solid ${devtoolsTheme.colors.border}`,
    borderRadius: devtoolsTheme.radii.md,
    background: devtoolsTheme.colors.background,
    color: devtoolsTheme.colors.foreground,
    fontFamily: devtoolsTheme.fontFamilies.monospace,
    fontSize: devtoolsTheme.fontSizes.sm,
    boxShadow: devtoolsTheme.shadows.floating,
  };
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
