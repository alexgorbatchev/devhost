import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";

import {
  css,
  cx,
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
  HoverSlidePanel,
  type IDevtoolsTheme,
  readDevtoolsControlToken,
  RESTART_SERVICE_PATH,
  useDevtoolsTheme,
} from "../../shared";
import type { ServiceHealth } from "../../shared/types";
import type { PanelSide } from "./types";

interface IServiceStatusPanelProps {
  errorMessage: string | null;
  panelSide: PanelSide;
  services: ServiceHealth[];
}

export function ServiceStatusPanel(props: IServiceStatusPanelProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
  const visibleServices: ServiceHealth[] = props.services;
  const shouldRenderPanel: boolean = props.errorMessage !== null || visibleServices.length > 0;

  if (!shouldRenderPanel) {
    return null;
  }

  const errorClassName: string = css(createErrorStyle(theme, props.panelSide));
  const listClassName: string = css(createListStyle(theme));
  const linkClassName: string = css(createLinkStyle(theme));
  const nameClassName: string = css(createNameStyle(theme, props.panelSide));
  const rowClassName: string = css(createRowStyle(theme, props.panelSide));
  const restartButtonClassName: string = css(createRestartButtonStyle(theme));

  return (
    <HoverSlidePanel
      ariaLabel="devhost services"
      panelSide={props.panelSide}
      peekWidth={theme.sizes.serviceStatusPanelPeekWidth}
      testId="ServiceStatusPanel"
    >
      {props.errorMessage !== null ? <div class={errorClassName}>{props.errorMessage}</div> : null}
      {visibleServices.length > 0 ? (
        <ul class={listClassName} data-testid="ServiceStatusPanel--service-list">
          {visibleServices.map((service: ServiceHealth) => {
            const statusDotClassName: string = css(createStatusDotStyle(theme, service.status));
            const name =
              service.url === undefined ? (
                <span class={nameClassName}>{service.name}</span>
              ) : (
                <a
                  class={cx(nameClassName, linkClassName)}
                  href={service.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={`Open ${service.name} in a new window`}
                >
                  {service.name}
                </a>
              );

            const restartButton = (
              <button
                aria-label={`Restart ${service.name}`}
                class={restartButtonClassName}
                onClick={async (): Promise<void> => {
                  try {
                    await fetch(RESTART_SERVICE_PATH, {
                      body: JSON.stringify({ serviceName: service.name }),
                      headers: {
                        [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: readDevtoolsControlToken(),
                        "content-type": "application/json",
                      },
                      method: "POST",
                    });
                  } catch (error) {
                    console.error(`Failed to restart service ${service.name}:`, error);
                  }
                }}
                title={`Restart ${service.name}`}
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="12" height="12">
                  <path
                    fill="currentColor"
                    d="M463.5 224H472c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2L413.4 96.6c-87.6-86.5-228.7-86.2-315.8 1c-87.5 87.5-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3c62.2-62.2 162.7-62.5 225.3-1L327 183c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8H463.5z"
                  />
                </svg>
              </button>
            );

            return (
              <li key={service.name} class={rowClassName}>
                {props.panelSide === "left" ? (
                  <>
                    {name}
                    {restartButton}
                    <span aria-hidden="true" class={statusDotClassName} />
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" class={statusDotClassName} />
                    {restartButton}
                    {name}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </HoverSlidePanel>
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
    flexGrow: 1,
    fontSize: theme.fontSizes.sm,
    minWidth: 0,
    overflow: "hidden",
    textAlign: panelSide === "left" ? "right" : "left",
    textOverflow: "clip",
    whiteSpace: "nowrap",
  };
}

function createLinkStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    borderRadius: theme.radii.sm,
    color: theme.colors.foreground,
    cursor: "pointer",
    outline: "none",
    textDecoration: "underline",
    textDecorationColor: theme.colors.accentBackground,
    textUnderlineOffset: "2px",
    transition: "background 150ms ease, color 150ms ease",
    "&:visited": {
      color: theme.colors.foreground,
    },
    "&:hover": {
      color: theme.colors.accentBackground,
    },
    "&:focus-visible": {
      background: theme.colors.selectionBackground,
      color: theme.colors.accentBackground,
    },
  };
}

function createRowStyle(theme: IDevtoolsTheme, _panelSide: PanelSide): CSSObject {
  return {
    alignItems: "center",
    display: "flex",
    gap: theme.spacing.xs,
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

function createRestartButtonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "center",
    background: "transparent",
    border: "none",
    borderRadius: theme.radii.sm,
    color: theme.colors.foreground,
    cursor: "pointer",
    display: "flex",
    justifyContent: "center",
    opacity: 0.7,
    padding: "2px",
    transition: "opacity 150ms ease, background 150ms ease, color 150ms ease",
    "&:hover": {
      background: theme.colors.selectionBackground,
      color: theme.colors.foreground,
      opacity: 1,
    },
    "&:active": {
      opacity: 0.8,
    },
    "&:focus-visible": {
      opacity: 1,
    },
  };
}
