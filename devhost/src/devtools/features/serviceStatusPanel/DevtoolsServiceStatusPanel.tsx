import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";

import { css, type IDevtoolsTheme } from "../../shared";
import type { ServiceHealth } from "../../shared/types";
import { selectVisibleServices } from "./selectVisibleServices";

interface IDevtoolsServiceStatusPanelProps {
  errorMessage: string | null;
  services: ServiceHealth[];
  theme: IDevtoolsTheme;
}

export function DevtoolsServiceStatusPanel(props: IDevtoolsServiceStatusPanelProps): JSX.Element | null {
  const visibleServices: ServiceHealth[] = selectVisibleServices(props.services);
  const shouldRenderPanel: boolean = props.errorMessage !== null || visibleServices.length > 0;

  if (!shouldRenderPanel) {
    return null;
  }

  const errorClassName: string = css(createErrorStyle(props.theme));
  const listClassName: string = css(listStyle);
  const nameClassName: string = css(createNameStyle(props.theme));
  const panelClassName: string = css(createPanelStyle(props.theme));
  const rowClassName: string = css(rowStyle);

  return (
    <section aria-label="devhost services" class={panelClassName} data-testid="DevtoolsServiceStatusPanel">
      {props.errorMessage !== null ? <div class={errorClassName}>{props.errorMessage}</div> : null}
      {visibleServices.length > 0 ? (
        <ul class={listClassName} data-testid="DevtoolsServiceStatusPanel--service-list">
          {visibleServices.map((service: ServiceHealth) => {
            const statusDotClassName: string = css(createStatusDotStyle(service.status, props.theme));

            return (
              <li key={service.name} class={rowClassName}>
                <span aria-hidden="true" class={statusDotClassName} />
                <span class={nameClassName}>{service.name}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

const listStyle: CSSObject = {
  display: "grid",
  gap: "4px",
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const rowStyle: CSSObject = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
};

function createPanelStyle(theme: IDevtoolsTheme): CSSObject {
  return {
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

function createErrorStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    marginBottom: "6px",
    color: theme.colors.dangerForeground,
    fontSize: theme.fontSizes.sm,
  };
}

function createNameStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.foreground,
    fontSize: theme.fontSizes.sm,
  };
}

function createStatusDotStyle(isHealthy: boolean, theme: IDevtoolsTheme): CSSObject {
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
