import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";

import type { IAnnotationAction } from "../shared/devtoolsConfig";
import { AnnotationComposer } from "../features/annotationComposer";
import { AnnotationQueuePanel, useAnnotationQueues } from "../features/annotationQueue";
import { ComponentSourceMenu, useComponentSourceNavigation } from "../features/componentSourceNavigation";
import { ExternalDevtoolsPanel, useExternalDevtoolsLaunchers } from "../features/externalDevtoolsPanel";
import { LogMinimap, useServiceLogs } from "../features/minimap";
import { TerminalSessionTray, useTerminalSessions } from "../features/terminalSessions";
import { useReactHighlightOverlay } from "../features/reactHighlight";
import { ServiceStatusPanel, useServiceHealth } from "../features/serviceStatusPanel";
import { readInjectedDevtoolsConfig } from "../shared/readInjectedDevtoolsConfig";
import {
  ColorSchemeProvider,
  DEVTOOLS_ROOT_ID,
  resolveRoutedServiceKeyForUrl,
  useResolvedColorScheme,
  RESTART_SERVICE_PATH,
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
} from "../shared";

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
    restartServicesShortcut,
    primaryService,
  } = readInjectedDevtoolsConfig();
  const appRootReference = useRef<HTMLDivElement | null>(null);
  const { errorMessage, setErrorMessage, services } = useServiceHealth();
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

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      if (!parseAndMatchShortcut(restartServicesShortcut || "alt+ctrl+r", event)) {
        return;
      }

      const target = (event.composedPath()?.[0] || event.target) as HTMLElement;
      if (target) {
        const tagName = target.tagName?.toLowerCase();
        const isInput =
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select" ||
          target.isContentEditable ||
          target.closest?.(".xterm") !== null ||
          target.closest?.("[contenteditable]") !== null;
        if (isInput) return;
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

      try {
        const response = await fetch(RESTART_SERVICE_PATH, {
          body: JSON.stringify({ serviceNames: targetServiceNames }),
          headers: {
            [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: controlToken,
            "content-type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          const bodyText = await response.text();
          let parsedError = bodyText;
          try {
            const parsed = JSON.parse(bodyText);
            parsedError = parsed.error || parsed.message || bodyText;
          } catch {}
          setErrorMessage(`Failed to restart service(s) ${targetServiceNames.join(", ")}: ${parsedError}`);
        } else {
          setErrorMessage(null);
        }
      } catch (error: unknown) {
        console.error(`Failed to restart service(s) ${targetServiceNames.join(", ")}:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        setErrorMessage(`Failed to restart service(s) ${targetServiceNames.join(", ")}: ${errorMsg}`);
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [restartServicesShortcut, services, primaryService, controlToken, setErrorMessage]);
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
        {shouldRenderPanel ? (
          <ServiceStatusPanel errorMessage={errorMessage} services={services} onSetErrorMessage={setErrorMessage} />
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
