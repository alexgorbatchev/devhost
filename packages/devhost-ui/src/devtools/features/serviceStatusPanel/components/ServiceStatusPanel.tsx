import { useRef, useState, type JSX } from "react";
import { ArrowLeftIcon, ChevronDownIcon, GitBranchIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "../../../../components/ui/Badge";
import { Kbd } from "../../../../components/ui/Kbd";
import { cn } from "../../../../lib/utils";

import { Button, InlineNotice } from "../../../shared";
import { restartServices } from "../../../shared/restartServices";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import { DEFAULT_RESTART_SERVICES_SHORTCUT } from "../../../shared/constants";
import { formatShortcutLabel } from "../../../shared/formatShortcutLabel";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import type { ServiceHealth, WorktreeRepository } from "../../../shared/types";

import { WorktreePicker } from "./WorktreePicker";
import { formatWorktreePath } from "../formatWorktreePath";

interface IServiceStatusPanelProps {
  errorMessage: string | null;
  onSetErrorMessage?: (message: string | null) => void;
  services: ServiceHealth[];
  repositories?: WorktreeRepository[];
  onRefreshWorktrees?: () => Promise<string | null>;
  onSwitchWorktree?: (repositoryId: string, path: string) => Promise<string | null>;
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
  const { homeDirectoryPath, restartServicesShortcut } = readInjectedDevtoolsConfig();
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const repositoryButtons = useRef<Map<string, HTMLButtonElement>>(new Map());
  const repositories = props.repositories ?? [];
  const selectedRepository = repositories.find((repository) => repository.id === repositoryId);
  const onBack = (): void => {
    setRepositoryId(null);
    requestAnimationFrame(() => {
      if (repositoryId !== null) repositoryButtons.current.get(repositoryId)?.focus();
    });
  };
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
        selectedRepository === undefined ? (
          <Kbd title="Restart changed services, or the primary service when none changed">
            {formatShortcutLabel(restartServicesShortcut ?? DEFAULT_RESTART_SERVICES_SHORTCUT)}
          </Kbd>
        ) : (
          <Button aria-label="Back to services" variant="ghost" startEnhancer={<ArrowLeftIcon />} onClick={onBack} />
        )
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
      panelLabel={selectedRepository === undefined ? "Services" : selectedRepository.name + " · Worktrees"}
      panelWidth={selectedRepository === undefined ? (repositories.length > 0 ? "md" : "sm") : "lg"}
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
      {selectedRepository !== undefined &&
      props.onRefreshWorktrees !== undefined &&
      props.onSwitchWorktree !== undefined ? (
        <WorktreePicker
          key={selectedRepository.id}
          repository={selectedRepository}
          hasRestartingService={props.services.some(
            (service) => selectedRepository.serviceNames.includes(service.name) && service.restarting === true,
          )}
          onBack={onBack}
          onRefresh={props.onRefreshWorktrees}
          onSwitch={props.onSwitchWorktree}
        />
      ) : (
        <>
          {repositories.map((repository) => {
            const selected = repository.worktrees.find((entry) => entry.path === repository.selectedPath);
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
                  <Button
                    ref={(button): void => {
                      if (button === null) repositoryButtons.current.delete(repository.id);
                      else repositoryButtons.current.set(repository.id, button);
                    }}
                    aria-label={"Choose worktree for " + repository.name}
                    title={formatWorktreePath(repository.selectedPath, homeDirectoryPath)}
                    disabled={props.onSwitchWorktree === undefined}
                    startEnhancer={<GitBranchIcon />}
                    endEnhancer={<ChevronDownIcon />}
                    onClick={(): void => {
                      setRepositoryId(repository.id);
                    }}
                  >
                    {selected?.branch ||
                      (selected?.detached === true ? "Detached " + selected.head.slice(0, 7) : "Unavailable worktree")}
                  </Button>
                </header>
                <ServiceRows
                  services={props.services.filter((service) => repository.serviceNames.includes(service.name))}
                  onSetErrorMessage={onSetErrorMessage}
                  isBlocked={repository.switching || repository.error !== undefined}
                />
              </section>
            );
          })}
          <ServiceRows
            services={props.services.filter(
              (service) => !repositories.some((repository) => repository.serviceNames.includes(service.name)),
            )}
            onSetErrorMessage={onSetErrorMessage}
            isBlocked={false}
          />
        </>
      )}
    </ToolbarPopover>
  );
}

interface IServiceRowsProps {
  services: ServiceHealth[];
  onSetErrorMessage?: (message: string | null) => void;
  isBlocked: boolean;
}
function ServiceRows({ services, onSetErrorMessage, isBlocked }: IServiceRowsProps): JSX.Element {
  return (
    <ul className="m-0 list-none p-0" data-testid="ServiceStatusPanel--service-list">
      {services.map((service: ServiceHealth) => {
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
                disabled={service.restarting === true || isBlocked}
                startEnhancer={
                  <span className={cn("flex", service.restarting === true && "animate-spin")}>
                    <RotateCwIcon />
                  </span>
                }
                title={service.restarting === true ? "Restarting…" : `Restart ${service.name}`}
                variant={isChanged ? "warning" : "default"}
                onClick={(): void => {
                  void restartServices([service.name], fetch).then((message) => onSetErrorMessage?.(message));
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
