import type { ITerminalSessionBehavior } from "./types";

export interface IPanelSize {
  height: number;
  width: number;
}

export interface IResolvedTerminalPanelLayout {
  expandedPanelSize: IPanelSize;
  isFullscreenExpanded: boolean;
  trayPanelSize: IPanelSize;
}

const minimumPanelHeight: number = 240;
const minimumPanelWidth: number = 320;
const panelViewportMargin: number = 80;
const preferredPanelHeight: number = 720;
const preferredPanelWidth: number = 1040;

export function resolveTerminalPanelLayout(
  behavior: ITerminalSessionBehavior,
  viewportWidth: number,
  viewportHeight: number,
): IResolvedTerminalPanelLayout {
  const trayPanelSize: IPanelSize = {
    height: Math.max(minimumPanelHeight, Math.min(preferredPanelHeight, viewportHeight - panelViewportMargin)),
    width: Math.max(minimumPanelWidth, Math.min(preferredPanelWidth, viewportWidth - panelViewportMargin)),
  };
  const isFullscreenExpanded: boolean = behavior.isFullscreenExpanded;

  return {
    expandedPanelSize: isFullscreenExpanded
      ? {
          height: viewportHeight,
          width: viewportWidth,
        }
      : trayPanelSize,
    isFullscreenExpanded,
    trayPanelSize,
  };
}
