import type { JSX } from "react";
import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "../../../../components/ui/Badge";
import { Kbd } from "../../../../components/ui/Kbd";
import { cn } from "../../../../lib/utils";

import { Button, DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, InlineNotice, RESTART_SERVICE_PATH } from "../../../shared";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import { DEFAULT_RESTART_SERVICES_SHORTCUT } from "../../../shared/constants";
import { formatShortcutLabel } from "../../../shared/formatShortcutLabel";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import type { ServiceHealth } from "../../../shared/types";

interface IServiceStatusPanelProps {
  errorMessage: string | null;
  onSetErrorMessage?: (message: string | null) => void;
  services: ServiceHealth[];
}

type ServiceDotState = "down" | "dirty" | "ok" | "restarting";

const serviceDotClassNames: Record<ServiceDotState, string> = {
  dirty: "bg-warning",
  down: "bg-destructive ring-2 ring-destructive/25",
  ok: "bg-success",
  restarting: "animate-spin border-2 border-warning border-r-transparent",
};

const serviceStateLabels: Record<ServiceDotState, string> = {
  dirty: "up, files changed",
  down: "down",
  ok: "up",
  restarting: "restarting",
};

export function ServiceStatusPanel(props: IServiceStatusPanelProps): JSX.Element | null {
  const { controlToken, restartServicesShortcut } = readInjectedDevtoolsConfig();
  const hasError: boolean = props.errorMessage !== null;

  if (!hasError && props.services.length === 0) {
    return null;
  }

  const upCount: number = props.services.filter((service: ServiceHealth): boolean => service.status).length;
  const changedCount: number = props.services.filter((service: ServiceHealth): boolean => {
    return service.dirty === true && service.restarting !== true;
  }).length;
  const onSetErrorMessage = props.onSetErrorMessage;

  return (
    <ToolbarPopover
      headerEndEnhancer={
        <Kbd title="Restart changed services, or the primary service when none changed">
          {formatShortcutLabel(restartServicesShortcut ?? DEFAULT_RESTART_SERVICES_SHORTCUT)}
        </Kbd>
      }
      notice={
        props.errorMessage !== null ? (
          <InlineNotice
            testId="ServiceStatusPanel--error"
            tone="danger"
            onDismiss={
              onSetErrorMessage === undefined
                ? undefined
                : (): void => {
                    onSetErrorMessage(null);
                  }
            }
          >
            {props.errorMessage}
          </InlineNotice>
        ) : undefined
      }
      panelLabel="Services"
      panelWidth="sm"
      testId="ServiceStatusPanel"
      triggerContent={
        <>
          {hasError ? <TriangleAlertIcon aria-hidden="true" className="size-3.5" /> : null}
          <span aria-hidden="true" className="flex gap-[3px]">
            {props.services.map((service: ServiceHealth) => (
              <ServiceStatusDot key={service.name} service={service} />
            ))}
          </span>
          <span aria-hidden="true">{`${upCount}/${props.services.length}`}</span>
          {changedCount > 0 && !hasError ? (
            <Badge aria-hidden="true" variant="warning">{`${changedCount} changed`}</Badge>
          ) : null}
        </>
      }
      triggerLabel={readServicesTriggerLabel(upCount, props.services.length, changedCount, hasError)}
      triggerTone={hasError ? "alert" : "default"}
    >
      <ul className="m-0 list-none p-0" data-testid="ServiceStatusPanel--service-list">
        {props.services.map((service: ServiceHealth) => {
          const dotState: ServiceDotState = readServiceDotState(service);
          const isChanged: boolean = dotState === "dirty";

          return (
            <li
              key={service.name}
              className="flex min-h-6 items-center gap-1.5 py-0.5 pr-1 pl-2 not-first:border-t hover:bg-secondary"
              data-testid="ServiceStatusPanel--service"
            >
              <ServiceStatusDot service={service} />
              <span className="sr-only">{serviceStateLabels[dotState]}</span>
              {service.url === undefined ? (
                <span className={cn("min-w-0 flex-1 truncate", !service.status && "font-semibold text-destructive")}>
                  {service.name}
                </span>
              ) : (
                <a
                  className={cn(
                    "min-w-0 flex-1 truncate underline decoration-faint underline-offset-2 hover:text-primary hover:decoration-primary",
                    service.status ? "text-foreground" : "font-semibold text-destructive",
                  )}
                  href={service.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={`Open ${service.name} in a new window`}
                >
                  {service.name}
                </a>
              )}
              {service.managed ? null : <Badge title="Not managed by devhost; cannot restart">external</Badge>}
              {isChanged ? <Badge variant="warning">changed</Badge> : null}
              {service.managed ? (
                <Button
                  aria-label={`Restart ${service.name}`}
                  disabled={service.restarting === true}
                  startEnhancer={
                    <span className={cn("flex", service.restarting === true && "animate-spin")}>
                      <RotateCwIcon />
                    </span>
                  }
                  title={service.restarting === true ? "Restarting…" : `Restart ${service.name}`}
                  variant={isChanged ? "warning" : "default"}
                  onClick={(): void => {
                    void restartService(service.name, controlToken, onSetErrorMessage);
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </ToolbarPopover>
  );
}

interface IServiceStatusDotProps {
  service: ServiceHealth;
}

function ServiceStatusDot(props: IServiceStatusDotProps): JSX.Element {
  const dotState: ServiceDotState = readServiceDotState(props.service);

  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 rounded-full", serviceDotClassNames[dotState])}
      data-state={dotState}
      title={`${props.service.name}: ${serviceStateLabels[dotState]}`}
    />
  );
}

function readServiceDotState(service: ServiceHealth): ServiceDotState {
  if (service.restarting === true) {
    return "restarting";
  }

  if (!service.status) {
    return "down";
  }

  return service.dirty === true ? "dirty" : "ok";
}

function readServicesTriggerLabel(
  upCount: number,
  totalCount: number,
  changedCount: number,
  hasError: boolean,
): string {
  const summary: string = `Services: ${upCount} of ${totalCount} up`;
  const changedSuffix: string = changedCount > 0 ? `, ${changedCount} changed` : "";
  const errorSuffix: string = hasError ? ", error" : "";

  return `${summary}${changedSuffix}${errorSuffix}`;
}

async function restartService(
  serviceName: string,
  controlToken: string,
  onSetErrorMessage: ((message: string | null) => void) | undefined,
): Promise<void> {
  try {
    const response = await fetch(RESTART_SERVICE_PATH, {
      body: JSON.stringify({ serviceName }),
      headers: {
        [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: controlToken,
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (response.ok) {
      onSetErrorMessage?.(null);
      return;
    }

    const bodyText: string = await response.text();
    let parsedError: string = bodyText;

    try {
      const parsed = JSON.parse(bodyText);
      parsedError = parsed.error || parsed.message || bodyText;
    } catch {}

    onSetErrorMessage?.(`Failed to restart service ${serviceName}: ${parsedError}`);
  } catch (error: unknown) {
    console.error(`Failed to restart service ${serviceName}:`, error);
    onSetErrorMessage?.(
      `Failed to restart service ${serviceName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
