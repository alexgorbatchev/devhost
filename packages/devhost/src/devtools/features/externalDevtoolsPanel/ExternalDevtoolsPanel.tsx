import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "react";

import { Button, css, HoverSlidePanel, useDevtoolsTheme } from "../../shared";
import type { PanelSide } from "../serviceStatusPanel";
import type { IExternalDevtoolsLauncher } from "./types";

interface IExternalDevtoolsPanelProps {
  launchers: IExternalDevtoolsLauncher[];
  panelSide: PanelSide;
  onToggleLauncher: (launcherId: string) => void;
}

export function ExternalDevtoolsPanel({
  launchers,
  panelSide,
  onToggleLauncher,
}: IExternalDevtoolsPanelProps): JSX.Element | null {
  const theme = useDevtoolsTheme();

  if (launchers.length === 0) {
    return null;
  }

  const hasOpenLauncher: boolean = launchers.some((launcher) => launcher.isOpen);
  const contentClassName: string = css(createContentStyle(theme, panelSide));
  const handleClassName: string = css(createHandleStyle(theme));
  const launcherListClassName: string = css(createLauncherListStyle(theme, panelSide));

  return (
    <HoverSlidePanel
      ariaLabel="external devtools"
      isPinned={hasOpenLauncher}
      panelSide={panelSide}
      peekWidth={theme.sizes.serviceStatusPanelPeekWidth}
      testId="ExternalDevtoolsPanel"
    >
      <div className={contentClassName}>
        {panelSide === "right" ? <span className={handleClassName}>Tools</span> : null}
        <div className={launcherListClassName} data-testid="ExternalDevtoolsPanel--launcher-list">
          {launchers.map((launcher) => (
            <Button
              key={launcher.id}
              ariaPressed={launcher.isOpen}
              title={launcher.title}
              variant={launcher.isOpen ? "primary" : "secondary"}
              onClick={(): void => onToggleLauncher(launcher.id)}
            >
              {launcher.label}
            </Button>
          ))}
        </div>
        {panelSide === "left" ? <span className={handleClassName}>Tools</span> : null}
      </div>
    </HoverSlidePanel>
  );
}

function createContentStyle(theme: ReturnType<typeof useDevtoolsTheme>, panelSide: PanelSide): CSSObject {
  return {
    alignItems: "center",
    display: "flex",
    flexDirection: panelSide === "left" ? "row" : "row-reverse",
    gap: theme.spacing.xs,
  };
}

function createHandleStyle(theme: ReturnType<typeof useDevtoolsTheme>): CSSObject {
  return {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };
}

function createLauncherListStyle(theme: ReturnType<typeof useDevtoolsTheme>, panelSide: PanelSide): CSSObject {
  return {
    display: "flex",
    flexDirection: panelSide === "left" ? "row-reverse" : "row",
    flexWrap: "wrap",
    gap: theme.spacing.xxs,
    justifyContent: panelSide === "left" ? "flex-end" : "flex-start",
  };
}
