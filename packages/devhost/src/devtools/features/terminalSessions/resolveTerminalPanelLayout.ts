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

const trayPanelHeight: number = 720;
const trayPanelWidth: number = 1040;

export function resolveTerminalPanelLayout(
  behavior: ITerminalSessionBehavior,
  viewportWidth: number,
  viewportHeight: number,
): IResolvedTerminalPanelLayout {
  const trayPanelSize: IPanelSize = {
    height: trayPanelHeight,
    width: trayPanelWidth,
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
