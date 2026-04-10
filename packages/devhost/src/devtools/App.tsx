import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";
import { useState } from "preact/hooks";

import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../types/stackTypes";
import { AnnotationComposer } from "./features/annotationComposer";
import { ComponentSourceMenu, useComponentSourceNavigation } from "./features/componentSourceNavigation";
import { LogMinimap, useServiceLogs } from "./features/minimap";
import { TerminalSessionTray, useTerminalSessions } from "./features/terminalSessions";
import { ServiceStatusPanel, type PanelSide, useServiceHealth } from "./features/serviceStatusPanel";
import { readDevtoolsFeatureToggles } from "./shared/readDevtoolsFeatureToggles";
import {
  css,
  DEVTOOLS_ROOT_ID,
  ThemeProvider,
  type IDevtoolsTheme,
  readDevtoolsAgentDisplayName,
  readDevtoolsComponentEditor,
  readDevtoolsMinimapPosition,
  readDevtoolsPosition,
  readDevtoolsProjectRootPath,
  readDevtoolsStackName,
  useDevtoolsTheme,
  useResolvedColorScheme,
} from "./shared";

export function App(): JSX.Element {
  const colorScheme = useResolvedColorScheme();

  return (
    <ThemeProvider colorScheme={colorScheme}>
      <AppContent />
    </ThemeProvider>
  );
}

function AppContent(): JSX.Element {
  const agentDisplayName: string = readDevtoolsAgentDisplayName();
  const componentEditor = readDevtoolsComponentEditor();
  const devtoolsMinimapPosition: DevtoolsMinimapPosition = readDevtoolsMinimapPosition();
  const devtoolsPosition: DevtoolsPosition = readDevtoolsPosition();
  const projectRootPath: string = readDevtoolsProjectRootPath();
  const stackName: string = readDevtoolsStackName();
  const features = readDevtoolsFeatureToggles();
  const theme = useDevtoolsTheme();
  const { errorMessage, services } = useServiceHealth();
  const {
    expandSession,
    minimizeSession,
    terminalSessions,
    removeSession,
    startComponentSourceSession,
    submitAnnotation,
  } = useTerminalSessions();
  const [isMinimapHovered, setIsMinimapHovered] = useState<boolean>(false);
  const logEntries = useServiceLogs(isMinimapHovered);
  const { componentMenu, openComponentSource } = useComponentSourceNavigation({
    componentEditor,
    projectRootPath,
    startComponentSourceSession,
    enabled: features.editorEnabled,
  });
  const shouldRenderPanel: boolean = features.statusEnabled && (errorMessage !== null || services.length > 0);
  const shouldRenderMinimap: boolean = features.minimapEnabled && logEntries.length > 0;
  const servicePanelSide: PanelSide = readPanelSide(devtoolsPosition);
  const activeAgentSessionId: string | undefined = terminalSessions.find((s) => s.kind === "agent")?.sessionId;
  const cornerDockClassName: string = css({
    ...readVerticalPositionStyle(theme, devtoolsPosition),
    ...readHorizontalPositionStyle(theme, devtoolsMinimapPosition, devtoolsPosition, shouldRenderMinimap),
    display: "grid",
    gap: theme.spacing.xxs,
    maxWidth: readCornerDockMaxWidth(theme),
    pointerEvents: "auto",
    position: "fixed",
    width: "fit-content",
    zIndex: Number(theme.zIndices.floating) + 1,
  });

  return (
    <div id={DEVTOOLS_ROOT_ID} data-devhost-devtools="" data-testid="AppContent">
      <AnnotationComposer
        activeAgentSessionId={activeAgentSessionId}
        agentDisplayName={agentDisplayName}
        onSubmit={submitAnnotation}
        stackName={stackName}
      />
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
      <div class={cornerDockClassName} data-testid="AppContent--corner-dock">
        {shouldRenderPanel ? (
          <ServiceStatusPanel errorMessage={errorMessage} panelSide={servicePanelSide} services={services} />
        ) : null}
      </div>
      <TerminalSessionTray
        sessions={terminalSessions}
        onExpandSession={expandSession}
        onMinimizeSession={minimizeSession}
        onRemoveSession={removeSession}
      />
      {shouldRenderMinimap ? (
        <LogMinimap
          entries={logEntries}
          isHovered={isMinimapHovered}
          minimapPosition={devtoolsMinimapPosition}
          onHoveredChange={setIsMinimapHovered}
        />
      ) : null}
    </div>
  );
}

function readCornerDockMaxWidth(theme: IDevtoolsTheme): string {
  return `calc(100vw - 20px - ${theme.spacing.xxs})`;
}

function readHorizontalPositionStyle(
  theme: IDevtoolsTheme,
  devtoolsMinimapPosition: DevtoolsMinimapPosition,
  devtoolsPosition: DevtoolsPosition,
  hasVisibleMinimap: boolean,
): CSSObject {
  const panelSide: DevtoolsMinimapPosition =
    devtoolsPosition === "top-left" || devtoolsPosition === "bottom-left" ? "left" : "right";
  const baseOffset: string = theme.spacing.sm;

  if (!hasVisibleMinimap || panelSide !== devtoolsMinimapPosition) {
    return panelSide === "left" ? { left: baseOffset } : { right: baseOffset };
  }

  const overlaidOffset: string = `calc(${baseOffset} + ${theme.spacing.xxs})`;

  return panelSide === "left" ? { left: overlaidOffset } : { right: overlaidOffset };
}

function readVerticalPositionStyle(theme: IDevtoolsTheme, devtoolsPosition: DevtoolsPosition): CSSObject {
  return devtoolsPosition === "top-left" || devtoolsPosition === "top-right"
    ? { top: theme.spacing.sm }
    : { bottom: theme.spacing.sm };
}

function readPanelSide(devtoolsPosition: DevtoolsPosition): PanelSide {
  return devtoolsPosition === "top-left" || devtoolsPosition === "bottom-left" ? "left" : "right";
}
