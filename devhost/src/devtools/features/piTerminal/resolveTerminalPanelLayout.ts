import type { ITerminalSession } from "./types";

const maximumPanelHeight: number = 720;
const maximumPanelWidth: number = 1040;
const minimumPanelHeight: number = 240;
const minimumPanelWidth: number = 320;
const panelViewportMargin: number = 24;

export interface IPanelSize {
  height: number;
  width: number;
}

export interface IResolvedTerminalPanelLayout {
  expandedPanelSize: IPanelSize;
  isFullscreenExpanded: boolean;
  trayPanelSize: IPanelSize;
}

export function resolveTerminalPanelLayout(
  sessionKind: ITerminalSession["kind"],
  viewportWidth: number,
  viewportHeight: number,
): IResolvedTerminalPanelLayout {
  const trayPanelSize: IPanelSize = {
    height: Math.max(minimumPanelHeight, Math.min(maximumPanelHeight, viewportHeight - panelViewportMargin)),
    width: Math.max(minimumPanelWidth, Math.min(maximumPanelWidth, viewportWidth - panelViewportMargin)),
  };
  const isFullscreenExpanded: boolean = sessionKind === "component-source";

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
