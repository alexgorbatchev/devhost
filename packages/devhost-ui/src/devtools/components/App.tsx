import type { JSX } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Icon } from "../../components/ui/Icon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { createDevtoolsSettingsStore } from "../shared/createDevtoolsSettingsStore";
import { PageChat } from "../features/agentChat/components/PageChat";

import { Button } from "../shared";

import { cn } from "../../lib/utils";

import type { ChatTarget, ServiceHealth } from "../shared/types";
import { ComponentSourceMenu, useComponentSourceNavigation } from "../features/componentSourceNavigation";
import {
  ConfigEditorButton,
  ConfigEditorPanel,
  ConfigRejectionNotice,
  createConfigEditorClient,
} from "../features/configEditor";
import { ExternalDevtoolsPanel, useExternalDevtoolsLaunchers } from "../features/externalDevtoolsPanel";
import { LogMinimap, useServiceLogs } from "../features/minimap";
import { useReactHighlightOverlay } from "../features/reactHighlight";
import { ResourceUsagePanel, useResourceUsage } from "../features/resourceUsage";
import {
  ServiceCrashOverlay,
  ServiceStatusPanel,
  WorktreeStatusPanel,
  useServiceHealth,
} from "../features/serviceStatusPanel";
import { pristineFetch } from "../shared/pristineFetch";
import { restartServices } from "../shared/restartServices";
import { readInjectedDevtoolsConfig } from "../shared/readInjectedDevtoolsConfig";
import { isEventTargetEditingSurface } from "../shared/isEventTargetEditingSurface";
import { DevtoolsToolbar } from "../shared/components/DevtoolsToolbar";
import { ToolbarSegment } from "../shared/components/ToolbarSegment";
import { DevtoolsTopLayer } from "../shared/components/DevtoolsTopLayer";
import { useRetainedValue } from "../shared/hooks/useRetainedValue";
import { ColorSchemeProvider, resolveRoutedServiceKeyForUrl, useResolvedColorScheme } from "../shared";
import { DEFAULT_RESTART_SERVICES_SHORTCUT } from "../shared/constants";
import { selectRestartServiceNames } from "../shared/selectRestartServiceNames";

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
    annotationEnabled,
    chatEnabled,
    componentEditor,
    configEditorEnabled,
    devhostSourceRootPath,
    editorEnabled,
    externalToolbarsEnabled,
    homeDirectoryPath,
    minimapEnabled,
    position: devtoolsPosition,
    projectRootPath: configuredProjectRootPath,
    resourcesEnabled,
    routedServices,
    stackName,
    statusEnabled,
    restartServicesShortcut,
    primaryService,
  } = readInjectedDevtoolsConfig();
  const appRootReference = useRef<HTMLDivElement | null>(null);
  const [isConfigEditorOpen, setIsConfigEditorOpen] = useState<boolean>(false);
  const configEditorClient = useMemo(() => createConfigEditorClient(pristineFetch), []);
  const {
    configuration,
    errorMessage,
    setErrorMessage,
    services,
    stoppedServices,
    repositories,
    refreshWorktrees,
    switchWorktree,
    startStoppedServices,
  } = useServiceHealth();
  const currentRoutedServiceKey = resolveRoutedServiceKeyForUrl(routedServices, window.location.href);
  const currentRepository = repositories.find(
    (repository) => currentRoutedServiceKey !== null && repository.serviceNames.includes(currentRoutedServiceKey),
  );
  const projectRootPath =
    services.find((service) => service.name === currentRoutedServiceKey)?.projectRootPath ?? configuredProjectRootPath;
  const { launchers: externalDevtoolsLaunchers, toggleLauncher } =
    useExternalDevtoolsLaunchers(externalToolbarsEnabled);
  const resourceUsage = useResourceUsage(resourcesEnabled);
  const [isMinimapHovered, setIsMinimapHovered] = useState<boolean>(false);
  const settingsStore = useMemo(
    () =>
      createDevtoolsSettingsStore(
        {
          projectRootPath,
          pageURL: window.location.href,
        },
        () => window.localStorage,
      ),
    [projectRootPath],
  );
  const isChatOpen = useStore(settingsStore, (state) => state.chat.isOpen);
  const [isChatBusy, setIsChatBusy] = useState(false);
  const setIsChatOpen = useCallback(
    (isOpen: boolean): void => {
      settingsStore.getState().updateChat({ isOpen });
    },
    [settingsStore],
  );
  const savedChatTarget = useStore(settingsStore, (state) => state.chat.target);
  const isDevhostChatAvailable: boolean = devhostSourceRootPath !== "";
  const chatTarget: ChatTarget = isDevhostChatAvailable ? savedChatTarget : "project";
  const chatRootPath: string = chatTarget === "devhost" ? devhostSourceRootPath : projectRootPath;
  // Conversations belong to the directory the agents run in. When that is the project root, the page's own store
  // holds them: a second store with the same scope would overwrite its persisted state.
  const chatSettingsStore = useMemo(
    () =>
      chatRootPath === projectRootPath
        ? settingsStore
        : createDevtoolsSettingsStore(
            {
              projectRootPath: chatRootPath,
              pageURL: window.location.href,
            },
            () => window.localStorage,
          ),
    [chatRootPath, projectRootPath, settingsStore],
  );
  const setChatTarget = useCallback(
    (target: ChatTarget): void => {
      settingsStore.getState().updateChat({ target });
    },
    [settingsStore],
  );
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

      const targetServiceNames = selectRestartServiceNames(services, primaryService);

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
  const shouldRenderToolbar: boolean = statusEnabled || externalToolbarsEnabled || chatEnabled || configEditorEnabled;
  const isConfigurationRejected: boolean = configuration.some((status) => status.error !== undefined);
  const openConfigEditor = useCallback((): void => {
    setIsConfigEditorOpen(true);
  }, []);
  const shouldRenderMinimap: boolean = minimapEnabled && logEntries.length > 0;
  return (
    <DevtoolsTopLayer ref={appRootReference}>
      {chatEnabled ? (
        <PageChat
          key={`${chatTarget}:${chatRootPath}`}
          settingsStore={chatSettingsStore}
          target={chatTarget}
          onTargetChange={isDevhostChatAvailable ? setChatTarget : undefined}
          isOpen={isChatOpen}
          onOpenChange={setIsChatOpen}
          onBusyChange={setIsChatBusy}
          isSelectionEnabled={annotationEnabled}
          rootReference={appRootReference}
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
          collapsedIndicator={
            <>
              <StackHealthIndicator errorMessage={errorMessage} services={services} />
            </>
          }
          readout={
            isConfigurationRejected ? (
              <ConfigRejectionNotice
                configuration={configuration}
                onEdit={configEditorEnabled ? openConfigEditor : undefined}
              />
            ) : undefined
          }
          isMinimapVisible={shouldRenderMinimap}
          position={devtoolsPosition}
          stackName={stackName}
        >
          {shouldRenderPanel ? (
            <ServiceStatusPanel
              errorMessage={errorMessage}
              services={services}
              stoppedServices={stoppedServices}
              repositories={repositories}
              onStartServices={startStoppedServices}
              onSetErrorMessage={setErrorMessage}
            />
          ) : null}
          <WorktreeStatusPanel
            repositories={repositories}
            services={services}
            onRefreshWorktrees={refreshWorktrees}
            onSwitchWorktree={switchWorktree}
          />
          {resourcesEnabled ? <ResourceUsagePanel usage={resourceUsage} /> : null}
          {configEditorEnabled ? (
            <ConfigEditorButton
              isOpen={isConfigEditorOpen}
              isRejected={isConfigurationRejected}
              onToggle={(): void => {
                setIsConfigEditorOpen((isOpen: boolean): boolean => !isOpen);
              }}
            />
          ) : null}
          {shouldRenderExternalDevtoolsPanel ? (
            <ExternalDevtoolsPanel launchers={externalDevtoolsLaunchers} onToggleLauncher={toggleLauncher} />
          ) : null}
          {chatEnabled ? (
            <ToolbarSegment ariaLabel="Chat">
              <Button
                aria-expanded={isChatOpen}
                aria-busy={isChatBusy}
                startEnhancer={isChatBusy ? <Icon glyph={LoaderCircleIcon} isSpinning /> : undefined}
                onClick={() => setIsChatOpen(!isChatOpen)}
              >
                Chat
              </Button>
            </ToolbarSegment>
          ) : null}
        </DevtoolsToolbar>
      ) : null}
      {configEditorEnabled ? (
        <ConfigEditorPanel
          client={configEditorClient}
          configuration={configuration}
          homeDirectoryPath={homeDirectoryPath}
          isOpen={isConfigEditorOpen}
          projectRootPath={configuredProjectRootPath}
          onClose={(): void => {
            setIsConfigEditorOpen(false);
          }}
        />
      ) : null}
      {shouldRenderMinimap ? (
        <LogMinimap
          entries={logEntries}
          serviceNames={[...services, ...stoppedServices].map((service) => service.name)}
          isHovered={isMinimapHovered}
          onHoveredChange={setIsMinimapHovered}
        />
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
