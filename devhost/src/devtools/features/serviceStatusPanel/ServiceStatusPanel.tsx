import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { css, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";
import type { ServiceHealth } from "../../shared/types";
import { resolveServiceStatusPanelTransform } from "./resolveServiceStatusPanelTransform";
import { selectVisibleServices } from "./selectVisibleServices";
import type { PanelSide } from "./types";

interface IServiceStatusPanelProps {
  errorMessage: string | null;
  panelSide: PanelSide;
  services: ServiceHealth[];
}

const serviceStatusPanelTransition: string = "transform 160ms ease";

export function ServiceStatusPanel(props: IServiceStatusPanelProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
  const visibleServices: ServiceHealth[] = selectVisibleServices(props.services);
  const shouldRenderPanel: boolean = props.errorMessage !== null || visibleServices.length > 0;
  const [isHovered, setIsHovered] = useState<boolean>(false);

  if (!shouldRenderPanel) {
    return null;
  }

  const errorClassName: string = css(createErrorStyle(theme, props.panelSide));
  const listClassName: string = css(createListStyle(theme));
  const nameClassName: string = css(createNameStyle(theme, props.panelSide));
  const panelClassName: string = css(createPanelStyle(theme, props.panelSide, isHovered));
  const rowClassName: string = css(createRowStyle(theme, props.panelSide));

  return (
    <section
      aria-label="devhost services"
      class={panelClassName}
      data-testid="ServiceStatusPanel"
      onMouseEnter={(): void => {
        setIsHovered(true);
      }}
      onMouseLeave={(): void => {
        setIsHovered(false);
      }}
    >
      {props.errorMessage !== null ? <div class={errorClassName}>{props.errorMessage}</div> : null}
      {visibleServices.length > 0 ? (
        <ul class={listClassName} data-testid="ServiceStatusPanel--service-list">
          {visibleServices.map((service: ServiceHealth) => {
            const statusDotClassName: string = css(createStatusDotStyle(theme, service.status));

            return (
              <li key={service.name} class={rowClassName}>
                {props.panelSide === "left" ? <span class={nameClassName}>{service.name}</span> : null}
                <span aria-hidden="true" class={statusDotClassName} />
                {props.panelSide === "right" ? <span class={nameClassName}>{service.name}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function createErrorStyle(theme: IDevtoolsTheme, panelSide: PanelSide): CSSObject {
  return {
    color: theme.colors.dangerForeground,
    fontSize: theme.fontSizes.sm,
    marginBottom: theme.spacing.xs,
    textAlign: panelSide,
    whiteSpace: "nowrap",
  };
}

function createListStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    gap: theme.spacing.xxs,
    listStyle: "none",
    margin: 0,
    padding: 0,
  };
}

function createNameStyle(theme: IDevtoolsTheme, panelSide: PanelSide): CSSObject {
  return {
    color: theme.colors.foreground,
    fontSize: theme.fontSizes.sm,
    overflow: "hidden",
    textAlign: panelSide,
    textOverflow: "clip",
    whiteSpace: "nowrap",
  };
}

function createPanelStyle(theme: IDevtoolsTheme, panelSide: PanelSide, isHovered: boolean): CSSObject {
  return {
    background: theme.colors.background,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    boxShadow: theme.shadows.floating,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    overflow: "hidden",
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    position: "relative",
    transform: resolveServiceStatusPanelTransform(panelSide, isHovered, theme.sizes.serviceStatusPanelPeekWidth),
    transition: serviceStatusPanelTransition,
    willChange: "transform",
    zIndex: Number(theme.zIndices.floating) + 2,
  };
}

function createRowStyle(theme: IDevtoolsTheme, panelSide: PanelSide): CSSObject {
  return {
    alignItems: "center",
    display: "flex",
    gap: theme.spacing.xs,
    justifyContent: panelSide === "left" ? "flex-start" : "flex-end",
  };
}

function createStatusDotStyle(theme: IDevtoolsTheme, isHealthy: boolean): CSSObject {
  return {
    background: isHealthy ? theme.colors.successBackground : theme.colors.dangerBackground,
    borderRadius: theme.radii.pill,
    boxShadow: isHealthy
      ? `0 0 10px ${theme.colors.successGlow}, 0 0 4px ${theme.colors.successGlow}`
      : `0 0 10px ${theme.colors.dangerGlow}, 0 0 4px ${theme.colors.dangerGlow}`,
    flexShrink: 0,
    height: "8px",
    width: "8px",
  };
}
