import type { ITerminalSession } from "./types";

export interface ITerminalSessionKindConfig {
  defaultIsExpanded: boolean;
  isFullscreenExpanded: boolean;
  shouldAutoRemoveOnExit: boolean;
  terminalTitle: string;
}

const terminalSessionKindConfigByKind: Record<ITerminalSession["kind"], ITerminalSessionKindConfig> = {
  "component-source": {
    defaultIsExpanded: true,
    isFullscreenExpanded: true,
    shouldAutoRemoveOnExit: true,
    terminalTitle: "Neovim",
  },
  "pi-annotation": {
    defaultIsExpanded: false,
    isFullscreenExpanded: false,
    shouldAutoRemoveOnExit: false,
    terminalTitle: "Pi terminal",
  },
};

export function readTerminalSessionKindConfig(sessionKind: ITerminalSession["kind"]): ITerminalSessionKindConfig {
  return terminalSessionKindConfigByKind[sessionKind];
}
