import type { JSX } from "preact";

import { css, useDevtoolsTheme } from "../../shared";
import type { ServiceHealth } from "../../shared/types";
import { selectVisibleServices } from "./selectVisibleServices";

interface IServiceStatusPanelProps {
  errorMessage: string | null;
  services: ServiceHealth[];
}

export function ServiceStatusPanel(props: IServiceStatusPanelProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
  const visibleServices: ServiceHealth[] = selectVisibleServices(props.services);
  const shouldRenderPanel: boolean = props.errorMessage !== null || visibleServices.length > 0;

  if (!shouldRenderPanel) {
    return null;
  }

  const errorClassName: string = css({
    color: theme.colors.dangerForeground,
    fontSize: theme.fontSizes.sm,
    marginBottom: "6px",
  });
  const listClassName: string = css({
    display: "grid",
    gap: "4px",
    listStyle: "none",
    margin: 0,
    padding: 0,
  });
  const nameClassName: string = css({
    color: theme.colors.foreground,
    fontSize: theme.fontSizes.sm,
  });
  const panelClassName: string = css({
    background: theme.colors.background,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    boxShadow: theme.shadows.floating,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
  });
  const rowClassName: string = css({
    alignItems: "center",
    display: "flex",
    gap: "6px",
  });

  return (
    <section aria-label="devhost services" class={panelClassName} data-testid="ServiceStatusPanel">
      {props.errorMessage !== null ? <div class={errorClassName}>{props.errorMessage}</div> : null}
      {visibleServices.length > 0 ? (
        <ul class={listClassName} data-testid="ServiceStatusPanel--service-list">
          {visibleServices.map((service: ServiceHealth) => {
            const statusDotClassName: string = css({
              background: service.status ? theme.colors.successBackground : theme.colors.dangerBackground,
              borderRadius: theme.radii.pill,
              boxShadow: service.status
                ? `0 0 10px ${theme.colors.successGlow}, 0 0 4px ${theme.colors.successGlow}`
                : `0 0 10px ${theme.colors.dangerGlow}, 0 0 4px ${theme.colors.dangerGlow}`,
              flexShrink: 0,
              height: "8px",
              width: "8px",
            });

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
