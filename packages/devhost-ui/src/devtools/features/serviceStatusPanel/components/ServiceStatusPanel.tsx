import { useRef, useState, type JSX } from "react";
import { ArrowLeftIcon, ChevronRightIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";

import { Badge } from "../../../../components/ui/Badge";
import { cn } from "../../../../lib/utils";

import { Button, InlineNotice } from "../../../shared";
import { pristineFetch } from "../../../shared/pristineFetch";
import { restartServices } from "../../../shared/restartServices";
import { selectRestartServiceNames } from "../../../shared/selectRestartServiceNames";
import { PanelActions } from "../../../shared/components/PanelActions";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import { RestartStackButton } from "../../../shared/components/RestartStackButton";
import { DEFAULT_RESTART_SERVICES_SHORTCUT } from "../../../shared/constants";
import { formatShortcutLabel } from "../../../shared/formatShortcutLabel";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import type { ServiceHealth, IStoppedService, IWorktreeRepository } from "../../../shared/types";

import { StoppedServices } from "./StoppedServices";

interface IServiceStatusPanelProps {
  errorMessage: string | null;
  onSetErrorMessage?: (message: string | null) => void;
  services: ServiceHealth[];
  stoppedServices?: IStoppedService[];
  repositories?: IWorktreeRepository[];
  onStartServices?: (serviceNames: string[]) => Promise<string | null>;
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

const serviceNameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function ServiceStatusPanel(props: IServiceStatusPanelProps): JSX.Element | null {
  const { restartServicesShortcut, primaryService } = readInjectedDevtoolsConfig();
  const restartServiceNames = selectRestartServiceNames(props.services, primaryService);
  const [isStackRestarting, setIsStackRestarting] = useState<boolean>(false);
  const [isChangedRestarting, setIsChangedRestarting] = useState<boolean>(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const isRestartPending = isStackRestarting || isChangedRestarting;
  const [isChoosingStoppedService, setIsChoosingStoppedService] = useState<boolean>(false);
  const stoppedServicesButton = useRef<HTMLButtonElement | null>(null);
  const repositories = props.repositories ?? [];
  const stoppedServices = props.stoppedServices ?? [];
  const onStartServices = props.onStartServices;
  // The view closes by itself once its last service has started.
  const isShowingStoppedServices: boolean =
    isChoosingStoppedService && stoppedServices.length > 0 && onStartServices !== undefined;
  const isShowingServices: boolean = !isShowingStoppedServices;
  const onBack = (): void => {
    setIsChoosingStoppedService(false);
    requestAnimationFrame(() => {
      stoppedServicesButton.current?.focus();
    });
  };
  const errorMessage = props.errorMessage ?? restartError;
  const hasError: boolean = errorMessage !== null;

  if (!hasError && props.services.length === 0 && stoppedServices.length === 0) {
    return null;
  }

  const upCount: number = props.services.filter((service: ServiceHealth): boolean => service.status).length;
  const changedCount: number = props.services.filter((service: ServiceHealth): boolean => {
    return service.dirty === true && service.restarting !== true;
  }).length;
  const onSetErrorMessage = props.onSetErrorMessage;
  const changedServiceNames = props.services
    .filter((service) => service.dirty && service.managed)
    .map((service) => service.name);
  const isRestartBlocked =
    isRestartPending ||
    props.services.some((service) => service.restarting === true) ||
    repositories.some((repository) => repository.switching);
  const handleRestartChanged = async (): Promise<void> => {
    if (isRestartBlocked || changedServiceNames.length === 0) return;
    setIsChangedRestarting(true);
    setRestartError(null);
    const message = await restartServices(changedServiceNames, pristineFetch);
    setRestartError(message);
    onSetErrorMessage?.(message);
    setIsChangedRestarting(false);
  };

  return (
    <span className="flex max-w-full items-center" data-testid="ServiceStatusPanel">
      <ToolbarPopover
        headerEndEnhancer={
          isShowingServices ? undefined : (
            <Button
              aria-label="Back to services"
              variant="ghost"
              startEnhancer={<Icon glyph={ArrowLeftIcon} />}
              onClick={onBack}
            />
          )
        }
        notice={
          errorMessage !== null ? (
            <InlineNotice
              testId="ServiceStatusPanel--error"
              tone="danger"
              onDismiss={
                restartError === null && onSetErrorMessage === undefined
                  ? undefined
                  : () => {
                      setRestartError(null);
                      onSetErrorMessage?.(null);
                    }
              }
            >
              {errorMessage}
            </InlineNotice>
          ) : undefined
        }
        panelLabel={isShowingStoppedServices ? "Stopped services" : "Services"}
        panelWidth={isShowingServices ? "lg" : "sm"}
        testId="ServiceStatusPanel--popover"
        triggerContent={
          <>
            {hasError ? <Icon glyph={TriangleAlertIcon} tone="destructive" /> : null}
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
        {isShowingStoppedServices && onStartServices !== undefined ? (
          <StoppedServices
            services={stoppedServices}
            isBlocked={
              isRestartPending ||
              props.services.some((service) => service.restarting === true) ||
              repositories.some((repository) => repository.switching)
            }
            onStart={onStartServices}
          />
        ) : (
          <>
            {repositories.map((repository) => {
              return (
                <section
                  key={repository.id}
                  aria-label={repository.name + " repository"}
                  className="not-first:border-t-2"
                >
                  <header className="flex items-center gap-1.5 border-b bg-secondary px-2 py-1">
                    <strong className="min-w-0 flex-1 truncate">{repository.name}</strong>
                    {repository.switching ? (
                      <Badge variant="warning">switching</Badge>
                    ) : repository.error !== undefined ? (
                      <Badge variant="destructive">stopped</Badge>
                    ) : null}
                  </header>
                  <ServiceLists
                    services={props.services.filter((service) => repository.serviceNames.includes(service.name))}
                    onSetErrorMessage={onSetErrorMessage}
                    isBlocked={isRestartPending || repository.switching || repository.error !== undefined}
                  />
                </section>
              );
            })}
            <ServiceLists
              services={props.services.filter(
                (service) => !repositories.some((repository) => repository.serviceNames.includes(service.name)),
              )}
              onSetErrorMessage={onSetErrorMessage}
              isBlocked={isRestartPending}
            />
            {stoppedServices.length > 0 ? (
              <PanelActions>
                <Button
                  ref={stoppedServicesButton}
                  disabled={onStartServices === undefined}
                  endEnhancer={<Icon glyph={ChevronRightIcon} />}
                  onClick={(): void => {
                    setIsChoosingStoppedService(true);
                  }}
                >
                  {`Stopped services (${stoppedServices.length})`}
                </Button>
              </PanelActions>
            ) : null}
            {props.services.some((service) => service.managed) ? (
              <RestartStackButton
                isDisabled={
                  isChangedRestarting ||
                  props.services.some((service) => service.restarting === true) ||
                  repositories.some((repository) => repository.switching)
                }
                onPendingChange={setIsStackRestarting}
                onRestartChanged={() => restartServices(restartServiceNames, pristineFetch)}
                isRestartChangedDisabled={restartServiceNames.length === 0}
                restartChangedShortcut={formatShortcutLabel(
                  restartServicesShortcut ?? DEFAULT_RESTART_SERVICES_SHORTCUT,
                )}
              />
            ) : null}
          </>
        )}
      </ToolbarPopover>
      {changedCount > 0 && !hasError ? (
        <Button
          aria-label="Restart changed services"
          title="Restart changed services"
          variant="ghost"
          disabled={isRestartBlocked || changedServiceNames.length === 0}
          startEnhancer={<Icon glyph={RotateCwIcon} isSpinning={isChangedRestarting} />}
          onClick={() => {
            void handleRestartChanged();
          }}
        />
      ) : null}
    </span>
  );
}

interface IServiceRowsProps {
  services: ServiceHealth[];
  onSetErrorMessage?: (message: string | null) => void;
  isBlocked: boolean;
}
function ServiceLists(props: IServiceRowsProps): JSX.Element {
  const sortedServices = props.services.toSorted((first, second) =>
    serviceNameCollator.compare(first.name, second.name),
  );
  const groups = [
    { label: "Applications", services: sortedServices.filter((service) => service.url !== undefined) },
    { label: "Services", services: sortedServices.filter((service) => service.url === undefined) },
  ];

  return (
    <>
      {groups
        .filter((group) => group.services.length > 0)
        .map((group) => (
          <div key={group.label} className="not-first:border-t">
            <h3 className="m-0 border-b bg-secondary px-2 py-1 font-semibold">{group.label}</h3>
            <ServiceRows {...props} services={group.services} label={group.label} />
          </div>
        ))}
    </>
  );
}

interface ILabeledServiceRowsProps extends IServiceRowsProps {
  label: string;
}

function ServiceRows({ services, onSetErrorMessage, isBlocked, label }: ILabeledServiceRowsProps): JSX.Element {
  return (
    <ul aria-label={label} className="m-0 list-none p-0" data-testid="ServiceRows">
      {services.map((service: ServiceHealth) => {
        const dotState: ServiceDotState = readServiceDotState(service);
        const isChanged: boolean = dotState === "dirty";

        return (
          <li
            key={service.name}
            className="flex min-h-6 items-center gap-1.5 py-0.5 pr-1 pl-2 not-first:border-t hover:bg-secondary"
            data-testid="ServiceRows--service"
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
                disabled={service.restarting === true || isBlocked}
                startEnhancer={<Icon glyph={RotateCwIcon} isSpinning={service.restarting === true} />}
                title={service.restarting === true ? "Restarting…" : `Restart ${service.name}`}
                variant={isChanged ? "warning" : "default"}
                onClick={(): void => {
                  void restartServices([service.name], pristineFetch).then((message) => onSetErrorMessage?.(message));
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
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
