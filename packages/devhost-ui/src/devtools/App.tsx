import type { JSX } from "react";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { DevtoolsPosition, IAnnotationAction } from "./shared/devtoolsConfig";
import { AnnotationComposer } from "./features/annotationComposer";
import { AnnotationQueuePanel, useAnnotationQueues } from "./features/annotationQueue";
import { ComponentSourceMenu, useComponentSourceNavigation } from "./features/componentSourceNavigation";
import { ExternalDevtoolsPanel, useExternalDevtoolsLaunchers } from "./features/externalDevtoolsPanel";
import { LogMinimap, useServiceLogs } from "./features/minimap";
import { TerminalSessionTray, useTerminalSessions } from "./features/terminalSessions";
import { useReactHighlightOverlay } from "./features/reactHighlight";
import { ServiceStatusPanel, useServiceHealth } from "./features/serviceStatusPanel";
import { readDevtoolsFeatureToggles } from "./shared/readDevtoolsFeatureToggles";
import {
  DEVTOOLS_ROOT_ID,
  ThemeProvider,
  readDevtoolsAnnotationActions,
  readDevtoolsAnnotationDefaultActionId,
  readDevtoolsComponentEditor,
  readDevtoolsControlToken,
  readDevtoolsPosition,
  readDevtoolsProjectRootPath,
  readDevtoolsRoutedServices,
  readDevtoolsStackName,
  resolveContrastingColorScheme,
  resolveRoutedServiceKeyForUrl,
  useResolvedColorScheme,
} from "./shared";

export function App(): JSX.Element {
  const hostColorScheme = useResolvedColorScheme();
  const colorScheme = resolveContrastingColorScheme(hostColorScheme);

  return (
    <ThemeProvider colorScheme={colorScheme}>
      <AppContent />
    </ThemeProvider>
  );
}

function AppContent(): JSX.Element {
  const annotationActions: IAnnotationAction[] = readDevtoolsAnnotationActions();
  const annotationDefaultActionId: string = readDevtoolsAnnotationDefaultActionId();
  const componentEditor = readDevtoolsComponentEditor();
  const controlToken: string = readDevtoolsControlToken();
  const devtoolsPosition: DevtoolsPosition = readDevtoolsPosition();
  const projectRootPath: string = readDevtoolsProjectRootPath();
  const routedServices = readDevtoolsRoutedServices();
  const stackName: string = readDevtoolsStackName();
  const features = readDevtoolsFeatureToggles();
  const appRootReference = useRef<HTMLDivElement | null>(null);
  const { errorMessage, services } = useServiceHealth();
  const {
    errorMessage: annotationQueueErrorMessage,
    isEntryMutationPending,
    isQueueResumePending,
    queues: annotationQueues,
    removeEntry,
    resumeQueue,
    saveEntry,
  } = useAnnotationQueues(features.annotationQueueEnabled);
  const { launchers: externalDevtoolsLaunchers, toggleLauncher } = useExternalDevtoolsLaunchers(
    features.externalToolbarsEnabled,
  );
  const {
    expandSession,
    minimizeSession,
    registerStartedSession,
    terminalSessions,
    removeSession,
    startComponentSourceSession,
    submitAnnotation,
  } = useTerminalSessions(features.terminalEnabled);
  const [isMinimapHovered, setIsMinimapHovered] = useState<boolean>(false);
  const [selectedAnnotationActionId, setSelectedAnnotationActionId] = useState<string>(annotationDefaultActionId);
  const logEntries = useServiceLogs(isMinimapHovered);
  useReactHighlightOverlay({
    controlToken,
    enabled: features.editorEnabled,
    overlayRootReference: appRootReference,
    projectRootPath,
  });
  const { componentMenu, openComponentSource } = useComponentSourceNavigation({
    componentEditor,
    projectRootPath,
    startComponentSourceSession,
    enabled: features.editorEnabled,
  });
  const shouldRenderPanel: boolean = features.statusEnabled && (errorMessage !== null || services.length > 0);
  const shouldRenderExternalDevtoolsPanel: boolean =
    features.externalToolbarsEnabled && externalDevtoolsLaunchers.length > 0;
  const shouldRenderMinimap: boolean = features.minimapEnabled && logEntries.length > 0;
  const currentRoutedServiceKey: string | null = resolveRoutedServiceKeyForUrl(routedServices, window.location.href);
  const selectedAnnotationAction: IAnnotationAction | null = features.annotationEnabled
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
      const sessionId = await resumeQueue(queueId);
      const activeAction = annotationActions.find((action: IAnnotationAction): boolean => {
        return action.id === activeEntry?.actionId;
      });

      if (sessionId !== null && activeEntry !== undefined && activeAction !== undefined) {
        registerStartedSession(sessionId, {
          actionId: activeAction.id,
          annotation: activeEntry.annotation,
          displayName: activeAction.displayName,
          kind: "agent",
        });
      }

      return sessionId;
    },
    [annotationActions, annotationQueues, registerStartedSession, resumeQueue],
  );
  return (
    <div id={DEVTOOLS_ROOT_ID} ref={appRootReference} data-devhost-devtools="" data-testid="AppContent">
      {features.annotationEnabled ? (
        <AnnotationComposer
          activeAgentSessionId={activeAgentSessionId}
          annotationActions={annotationActions}
          selectedActionId={selectedAnnotationAction?.id ?? ""}
          onSubmit={submitAnnotation}
          onSelectedActionIdChange={setSelectedAnnotationActionId}
          stackName={stackName}
        />
      ) : null}
      {componentMenu !== null ? (
        <ComponentSourceMenu
          errorMessage={componentMenu.errorMessage}
          items={componentMenu.items}
          position={{ x: componentMenu.x, y: componentMenu.y }}
          title={componentMenu.title}
          onItemClick={(itemIndex: number): void => {
            void openComponentSource(itemIndex);
          }}
        />
      ) : null}
      <div
        className={cn(
          "pointer-events-auto fixed z-[2147483501] grid w-fit max-w-[calc(100vw_-_24px)] gap-1",
          devtoolsPosition === "top-right" ? "top-2.5" : "bottom-2.5",
          shouldRenderMinimap ? "right-3.5" : "right-2.5",
        )}
        data-testid="AppContent--corner-dock"
      >
        {shouldRenderPanel ? <ServiceStatusPanel errorMessage={errorMessage} services={services} /> : null}
        {features.annotationQueueEnabled ? (
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
      </div>
      {features.terminalEnabled ? (
        <TerminalSessionTray
          sessions={terminalSessions}
          onExpandSession={expandSession}
          onMinimizeSession={minimizeSession}
          onRemoveSession={removeSession}
        />
      ) : null}
      {shouldRenderMinimap ? (
        <LogMinimap entries={logEntries} isHovered={isMinimapHovered} onHoveredChange={setIsMinimapHovered} />
      ) : null}
    </div>
  );
}

function resolveSelectedAnnotationAction(
  annotationActions: IAnnotationAction[],
  selectedAnnotationActionId: string,
): IAnnotationAction | null {
  return (
    annotationActions.find((action: IAnnotationAction): boolean => action.id === selectedAnnotationActionId) ??
    annotationActions[0] ??
    null
  );
}

function findActiveAgentSessionId(
  selectedAnnotationAction: IAnnotationAction | null,
  terminalSessions: ReturnType<typeof useTerminalSessions>["terminalSessions"],
  routedServices: ReturnType<typeof readDevtoolsRoutedServices>,
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
