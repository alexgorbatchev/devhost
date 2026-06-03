import type { JSX } from "react";
import { RotateCwIcon } from "lucide-react";

import { Badge } from "../../../../components/ui/Badge";
import { cn } from "../../../../lib/utils";

import { Button, DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, HoverSlidePanel, RESTART_SERVICE_PATH } from "../../../shared";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import type { ServiceHealth } from "../../../shared/types";

interface IServiceStatusPanelProps {
  errorMessage: string | null;
  services: ServiceHealth[];
}

export function ServiceStatusPanel(props: IServiceStatusPanelProps): JSX.Element | null {
  const { controlToken } = readInjectedDevtoolsConfig();
  const visibleServices: ServiceHealth[] = props.services;
  const shouldRenderPanel: boolean = props.errorMessage !== null || visibleServices.length > 0;

  if (!shouldRenderPanel) {
    return null;
  }

  return (
    <HoverSlidePanel
      ariaLabel="devhost services"
      error={props.errorMessage ?? undefined}
      testId="ServiceStatusPanel"
      title="Services"
    >
      {visibleServices.length > 0 ? (
        <ul className="grid list-none gap-1 p-0" data-testid="ServiceStatusPanel--service-list">
          {visibleServices.map((service: ServiceHealth) => {
            const managementBadgeLabel: string = service.managed ? "managed" : "external";
            const name =
              service.url === undefined ? (
                <span className="min-w-0 flex-1 truncate text-left text-xs text-foreground">{service.name}</span>
              ) : (
                <a
                  className="min-w-0 flex-1 truncate rounded-sm text-left text-xs text-foreground underline decoration-primary underline-offset-2 transition-colors visited:text-foreground hover:text-primary focus-visible:bg-accent focus-visible:text-primary focus-visible:outline-none"
                  href={service.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={`Open ${service.name} in a new window`}
                >
                  {service.name}
                </a>
              );

            return (
              <li key={service.name} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn("size-2 shrink-0 rounded-full", service.status ? "bg-primary" : "bg-destructive")}
                />
                {service.managed ? (
                  <Button
                    ariaLabel={`Restart ${service.name}`}
                    size="icon-sm"
                    startEnhancer={<RotateCwIcon data-icon="inline-start" />}
                    title={`Restart ${service.name}`}
                    variant="secondary"
                    onClick={async (): Promise<void> => {
                      try {
                        await fetch(RESTART_SERVICE_PATH, {
                          body: JSON.stringify({ serviceName: service.name }),
                          headers: {
                            [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: controlToken,
                            "content-type": "application/json",
                          },
                          method: "POST",
                        });
                      } catch (error) {
                        console.error(`Failed to restart service ${service.name}:`, error);
                      }
                    }}
                  />
                ) : null}
                {name}
                <Badge variant="secondary">{managementBadgeLabel}</Badge>
              </li>
            );
          })}
        </ul>
      ) : null}
    </HoverSlidePanel>
  );
}
