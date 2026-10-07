import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";

import type { ServiceHealth } from "../shared/types";
import type { IAnnotationAction } from "../shared/devtoolsConfig";
import { AnnotationComposer } from "../features/annotationComposer";
import { AnnotationQueuePanel, useAnnotationQueues } from "../features/annotationQueue";
import { ComponentSourceMenu, useComponentSourceNavigation } from "../features/componentSourceNavigation";
import { ExternalDevtoolsPanel, useExternalDevtoolsLaunchers } from "../features/externalDevtoolsPanel";
import { LogMinimap, useServiceLogs } from "../features/minimap";
import { TerminalSessionChips, TerminalSessionHost, useTerminalSessions } from "../features/terminalSessions";
import { useReactHighlightOverlay } from "../features/reactHighlight";
import { ServiceCrashOverlay, ServiceStatusPanel, useServiceHealth } from "../features/serviceStatusPanel";
import { pristineFetch } from "../shared/pristineFetch";
import { restartServices } from "../shared/restartServices";
import { readInjectedDevtoolsConfig } from "../shared/readInjectedDevtoolsConfig";
import { isEventTargetEditingSurface } from "../shared/isEventTargetEditingSurface";
import { DevtoolsToolbar } from "../shared/components/DevtoolsToolbar";
import { DevtoolsTopLayer } from "../shared/components/DevtoolsTopLayer";
import { useRetainedValue } from "../shared/hooks/useRetainedValue";
import {
  ColorSchemeProvider,
  resolveRoutedServiceKeyForUrl,
  useDevtoolsColorScheme,
  useResolvedColorScheme,
} from "../shared";
import { DEFAULT_RESTART_SERVICES_SHORTCUT } from "../shared/constants";

export function App(): JSX.Element {
  const hostColorScheme = useResolvedColorScheme();

  return (
    <ColorSchemeProvider colorScheme={hostColorScheme}>
      <AppContent />
    </ColorSchemeProvider>
  );
}

function AppContent(): JSX.Element {
  const {
    annotationActions,
    annotationDefaultActionId,
    annotationEnabled,
    annotationQueueEnabled,
    componentEditor,
    editorEnabled,
    externalToolbarsEnabled,
    minimapEnabled,
    position: devtoolsPosition,
    projectRootPath: configuredProjectRootPath,
    routedServices,
    stackName,
    statusEnabled,
    terminalEnabled,
    restartServicesShortcut,
    primaryService,
  } = readInjectedDevtoolsConfig();
  const appRootReference = useRef<HTMLDivElement | null>(null);
  const colorScheme = useDevtoolsColorScheme();
  const { errorMessage, setErrorMessage, services, repositories, refreshWorktrees, switchWorktree } =
    useServiceHealth();
  const currentRoutedServiceKey = resolveRoutedServiceKeyForUrl(routedServices, window.location.href);
  const currentRepository = repositories.find(
    (repository) => currentRoutedServiceKey !== null && repository.serviceNames.includes(currentRoutedServiceKey),
  );
  const projectRootPath =
    services.find((service) => service.name === currentRoutedServiceKey)?.projectRootPath ?? configuredProjectRootPath;
  const {
    errorMessage: annotationQueueErrorMessage,
    isEntryMutationPending,
    isQueueResumePending,
    queues: annotationQueues,
    removeEntry,
    resumeQueue,
    saveEntry,
  } = useAnnotationQueues(annotationQueueEnabled);
  const { launchers: externalDevtoolsLaunchers, toggleLauncher } =
    useExternalDevtoolsLaunchers(externalToolbarsEnabled);
  const {
    expandSession,
    minimizeSession,
    registerStartedSession,
    terminalSessions,
    removeSession,
    startComponentSourceSession,
    submitAnnotation,
    updateSessionStatus,
  } = useTerminalSessions(colorScheme, terminalEnabled);
  const [isMinimapHovered, setIsMinimapHovered] = useState<boolean>(false);
  const [selectedAnnotationActionId, setSelectedAnnotationActionId] = useState<string>(annotationDefaultActionId);
  const exitedServices = services.filter(
    (service) =>
      service.managed &&
      !service.status &&
      service.exitCode !== undefined &&
      !repositories.some(
        (repository) =>
          repository.serviceNames.includes(service.name) && (repository.switching || repository.error !== undefined),
      ),
  );
  const logEntries = useServiceLogs(isMinimapHovered && exitedServices.length === 0);
  useReactHighlightOverlay({
    enabled: editorEnabled,
    overlayRootReference: appRootReference,
    projectRootPath,
  });
  const { componentMenu, openComponentSource } = useComponentSourceNavigation({
    componentEditor,
    projectRootPath,
    startComponentSourceSession,
    worktreeRepository: currentRepository,
    enabled: editorEnabled && currentRepository?.switching !== true && currentRepository?.error === undefined,
  });
  // The menu stays mounted while it fades out, showing its last contents.
  const displayedComponentMenu = useRetainedValue(componentMenu, componentMenu !== null);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if (!parseAndMatchShortcut(restartServicesShortcut ?? DEFAULT_RESTART_SERVICES_SHORTCUT, event)) {
        return;
      }

      if (isEventTargetEditingSurface(event.composedPath().at(0) ?? event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const dirtyServices = services.filter((s) => s.dirty && !s.restarting);
      const activeRestarts = services.filter((s) => s.restarting);
      if (activeRestarts.length > 0) {
        return;
      }

      let targetServiceNames: string[] = [];
      if (dirtyServices.length === 1) {
        targetServiceNames = [dirtyServices[0].name];
      } else if (dirtyServices.length > 1) {
        targetServiceNames = dirtyServices.map((s) => s.name);
      } else if (primaryService) {
        targetServiceNames = [primaryService];
      }

      if (targetServiceNames.length === 0) {
        return;
      }

      setErrorMessage(await restartServices(targetServiceNames, pristineFetch));
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [restartServicesShortcut, services, primaryService, setErrorMessage]);
  const shouldRenderPanel: boolean = statusEnabled && (errorMessage !== null || services.length > 0);
  const shouldRenderExternalDevtoolsPanel: boolean = externalToolbarsEnabled && externalDevtoolsLaunchers.length > 0;
  const shouldRenderToolbar: boolean =
    statusEnabled || annotationQueueEnabled || externalToolbarsEnabled || terminalEnabled;
  const shouldRenderMinimap: boolean = minimapEnabled && logEntries.length > 0;
  const selectedAnnotationAction: IAnnotationAction | null = annotationEnabled
    ? resolveSelectedAnnotationAction(annotationActions, selectedAnnotationActionId)
    : null;
  const activeAgentSessionId: string | undefined = findActiveAgentSessionId(
    selectedAnnotationAction,
    terminalSessions,
    routedServices,
    currentRoutedServiceKey,
  );
  const handleResumeQueue = useCallback(
    async (queueId: string): Promise<string | null> => {
      const resumedQueue = annotationQueues.find((queue) => queue.queueId === queueId);
      const activeEntry = resumedQueue?.entries[0];
      const sessionId = await resumeQueue(queueId, colorScheme);
      const activeAction = annotationActions.find((action: IAnnotationAction): boolean => {
        return action.id === activeEntry?.actionId;
      });

      if (sessionId !== null && activeEntry !== undefined && activeAction !== undefined) {
        registerStartedSession({
          label: activeAction.label,
          request: {
            actionId: activeAction.id,
            annotation: activeEntry.annotation,
            colorScheme,
            kind: "agent",
          },
          sessionId,
        });
      }

      return sessionId;
    },
    [annotationActions, annotationQueues, colorScheme, registerStartedSession, resumeQueue],
  );
  return (
    <DevtoolsTopLayer ref={appRootReference}>
      {annotationEnabled ? (
        <AnnotationComposer
          activeAgentSessionId={activeAgentSessionId}
          annotationActions={annotationActions}
          selectedActionId={selectedAnnotationAction?.id ?? ""}
          onSubmit={submitAnnotation}
          onSelectedActionIdChange={setSelectedAnnotationActionId}
          stackName={stackName}
        />
      ) : null}
      {displayedComponentMenu !== null ? (
        <ComponentSourceMenu
          errorMessage={displayedComponentMenu.errorMessage}
          isOpen={componentMenu !== null}
          items={displayedComponentMenu.items}
          position={{ x: displayedComponentMenu.x, y: displayedComponentMenu.y }}
          title={displayedComponentMenu.title}
          onItemClick={(itemIndex: number): void => {
            void openComponentSource(itemIndex);
          }}
        />
      ) : null}
      {shouldRenderToolbar ? (
        <DevtoolsToolbar
          collapsedIndicator={<StackHealthIndicator errorMessage={errorMessage} services={services} />}
          isMinimapVisible={shouldRenderMinimap}
          position={devtoolsPosition}
          stackName={stackName}
        >
          {shouldRenderPanel ? (
            <ServiceStatusPanel
              errorMessage={errorMessage}
              services={services}
              repositories={repositories}
              onRefreshWorktrees={refreshWorktrees}
              onSwitchWorktree={switchWorktree}
              onSetErrorMessage={setErrorMessage}
            />
          ) : null}
          {annotationQueueEnabled ? (
            <AnnotationQueuePanel
              errorMessage={annotationQueueErrorMessage}
              isEntryMutationPending={isEntryMutationPending}
              isQueueResumePending={isQueueResumePending}
              onRemoveEntry={removeEntry}
              onResumeQueue={handleResumeQueue}
              onSaveEntry={saveEntry}
              queues={annotationQueues}
            />
          ) : null}
          {shouldRenderExternalDevtoolsPanel ? (
            <ExternalDevtoolsPanel launchers={externalDevtoolsLaunchers} onToggleLauncher={toggleLauncher} />
          ) : null}
          {terminalEnabled ? (
            <TerminalSessionChips
              sessions={terminalSessions}
              onExpandSession={expandSession}
              onMinimizeSession={minimizeSession}
              onRemoveSession={removeSession}
            />
          ) : null}
        </DevtoolsToolbar>
      ) : null}
      {terminalEnabled ? (
        <TerminalSessionHost
          isMinimapVisible={shouldRenderMinimap}
          sessions={terminalSessions}
          onMinimizeSession={minimizeSession}
          onRemoveSession={removeSession}
          onSessionStatusChange={updateSessionStatus}
        />
      ) : null}
      {shouldRenderMinimap ? (
        <LogMinimap entries={logEntries} isHovered={isMinimapHovered} onHoveredChange={setIsMinimapHovered} />
      ) : null}
      {statusEnabled && exitedServices.length > 0 ? (
        <ServiceCrashOverlay services={exitedServices} entries={logEntries} />
      ) : null}
    </DevtoolsTopLayer>
  );
}

type StackHealthState = "changed" | "down" | "healthy";

interface IStackHealthIndicatorProps {
  errorMessage: string | null;
  services: ServiceHealth[];
}

const stackHealthDotClassNames: Record<StackHealthState, string> = {
  changed: "bg-warning",
  down: "bg-destructive",
  healthy: "bg-success",
};

// Shown in place of the toolbar segments while the toolbar is collapsed: the worst state across the stack.
function StackHealthIndicator({ errorMessage, services }: IStackHealthIndicatorProps): JSX.Element {
  const healthState: StackHealthState = readStackHealthState(errorMessage, services);

  return (
    <span
      aria-label={`stack ${healthState}`}
      className={cn("size-2 rounded-full", stackHealthDotClassNames[healthState])}
      role="img"
    />
  );
}

function readStackHealthState(errorMessage: string | null, services: ServiceHealth[]): StackHealthState {
  if (errorMessage !== null || services.some((service: ServiceHealth): boolean => !service.status)) {
    return "down";
  }

  return services.some((service: ServiceHealth): boolean => service.dirty === true) ? "changed" : "healthy";
}

function resolveSelectedAnnotationAction(
  annotationActions: IAnnotationAction[],
  selectedAnnotationActionId: string,
): IAnnotationAction | null {
  return (
    annotationActions.find((action: IAnnotationAction): boolean => action.id === selectedAnnotationActionId) ??
    annotationActions.at(0) ??
    null
  );
}

function findActiveAgentSessionId(
  selectedAnnotationAction: IAnnotationAction | null,
  terminalSessions: ReturnType<typeof useTerminalSessions>["terminalSessions"],
  routedServices: ReturnType<typeof readInjectedDevtoolsConfig>["routedServices"],
  currentRoutedServiceKey: string | null,
): string | undefined {
  if (selectedAnnotationAction === null) {
    return undefined;
  }

  if (selectedAnnotationAction.kind !== "agent" || !selectedAnnotationAction.queueEnabled) {
    return undefined;
  }

  return terminalSessions.find((session) => {
    if (session.kind !== "agent" || session.actionId !== selectedAnnotationAction.id) {
      return false;
    }

    if (currentRoutedServiceKey === null) {
      return true;
    }

    return resolveRoutedServiceKeyForUrl(routedServices, session.annotation.url) === currentRoutedServiceKey;
  })?.sessionId;
}

function parseAndMatchShortcut(shortcut: string, event: KeyboardEvent): boolean {
  const parts = shortcut.toLowerCase().split("+");
  let targetCode = "";
  let reqAlt = false;
  let reqShift = false;
  let reqCtrl = false;
  let reqMeta = false;

  for (const part of parts) {
    if (part === "alt") {
      reqAlt = true;
    } else if (part === "shift") {
      reqShift = true;
    } else if (part === "ctrl") {
      reqCtrl = true;
    } else if (part === "meta" || part === "cmd") {
      reqMeta = true;
    } else if (/^[a-z]$/.test(part)) {
      targetCode = "Key" + part.toUpperCase();
    } else if (/^[0-9]$/.test(part)) {
      targetCode = "Digit" + part;
    }
  }

  return (
    event.code === targetCode &&
    event.altKey === reqAlt &&
    event.shiftKey === reqShift &&
    event.ctrlKey === reqCtrl &&
    event.metaKey === reqMeta
  );
}
