import type { JSX } from "react";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { IAnnotationAction } from "./shared/devtoolsConfig";
import { AnnotationComposer } from "./features/annotationComposer";
import { AnnotationQueuePanel, useAnnotationQueues } from "./features/annotationQueue";
import { ComponentSourceMenu, useComponentSourceNavigation } from "./features/componentSourceNavigation";
import { ExternalDevtoolsPanel, useExternalDevtoolsLaunchers } from "./features/externalDevtoolsPanel";
import { LogMinimap, useServiceLogs } from "./features/minimap";
import { TerminalSessionTray, useTerminalSessions } from "./features/terminalSessions";
import { useReactHighlightOverlay } from "./features/reactHighlight";
import { ServiceStatusPanel, useServiceHealth } from "./features/serviceStatusPanel";
import { readInjectedDevtoolsConfig } from "./shared/readInjectedDevtoolsConfig";
import {
  ColorSchemeProvider,
  DEVTOOLS_ROOT_ID,
  resolveMatchingColorScheme,
  resolveRoutedServiceKeyForUrl,
  useResolvedColorScheme,
} from "./shared";

export function App(): JSX.Element {
  const hostColorScheme = useResolvedColorScheme();
  const colorScheme = resolveMatchingColorScheme(hostColorScheme);

  return (
    <ColorSchemeProvider colorScheme={colorScheme}>
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
    controlToken,
    editorEnabled,
    externalToolbarsEnabled,
    minimapEnabled,
    position: devtoolsPosition,
    projectRootPath,
    routedServices,
    stackName,
    statusEnabled,
    terminalEnabled,
  } = readInjectedDevtoolsConfig();
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
  } = useTerminalSessions(terminalEnabled);
  const [isMinimapHovered, setIsMinimapHovered] = useState<boolean>(false);
  const [selectedAnnotationActionId, setSelectedAnnotationActionId] = useState<string>(annotationDefaultActionId);
  const logEntries = useServiceLogs(isMinimapHovered);
  useReactHighlightOverlay({
    controlToken,
    enabled: editorEnabled,
    overlayRootReference: appRootReference,
    projectRootPath,
  });
  const { componentMenu, openComponentSource } = useComponentSourceNavigation({
    componentEditor,
    projectRootPath,
    startComponentSourceSession,
    enabled: editorEnabled,
  });
  const shouldRenderPanel: boolean = statusEnabled && (errorMessage !== null || services.length > 0);
  const shouldRenderExternalDevtoolsPanel: boolean = externalToolbarsEnabled && externalDevtoolsLaunchers.length > 0;
  const shouldRenderMinimap: boolean = minimapEnabled && logEntries.length > 0;
  const currentRoutedServiceKey: string | null = resolveRoutedServiceKeyForUrl(routedServices, window.location.href);
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
          "pointer-events-auto fixed z-[var(--devhost-z-floating-raised)] grid w-fit max-w-[calc(100vw_-_24px)] gap-1",
          devtoolsPosition === "top-right" ? "top-2.5" : "bottom-2.5",
          shouldRenderMinimap ? "right-3.5" : "right-2.5",
        )}
        data-testid="AppContent--corner-dock"
      >
        {shouldRenderPanel ? <ServiceStatusPanel errorMessage={errorMessage} services={services} /> : null}
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
      </div>
      {terminalEnabled ? (
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
