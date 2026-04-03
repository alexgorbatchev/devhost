import type {
  AgentTerminalLauncher,
  EditorTerminalLauncher,
  IAgentTerminalSession,
  IEditorTerminalSession,
  IStartAgentTerminalSessionRequest,
  IStartEditorTerminalSessionRequest,
  IStartTerminalSessionRequest,
  ITerminalSession,
  ITerminalSessionBehavior,
  ITerminalSessionSummary,
} from "./types";

const terminalBehaviorByAgentLauncher: Record<AgentTerminalLauncher, ITerminalSessionBehavior> = {
  pi: {
    defaultIsExpanded: false,
    isFullscreenExpanded: false,
    shouldAutoRemoveOnExit: false,
  },
};

const terminalBehaviorByEditorLauncher: Record<EditorTerminalLauncher, ITerminalSessionBehavior> = {
  neovim: {
    defaultIsExpanded: true,
    isFullscreenExpanded: true,
    shouldAutoRemoveOnExit: true,
  },
};

const terminalTitleByAgentLauncher: Record<AgentTerminalLauncher, string> = {
  pi: "Agent terminal",
};

const trayTooltipSecondaryByAgentLauncher: Record<AgentTerminalLauncher, string> = {
  pi: "Pi",
};

const terminalTitleByEditorLauncher: Record<EditorTerminalLauncher, string> = {
  neovim: "Neovim",
};

export function createTerminalSession(sessionId: string, request: IStartTerminalSessionRequest): ITerminalSession {
  if (request.kind === "agent") {
    const behavior: ITerminalSessionBehavior = terminalBehaviorByAgentLauncher[request.launcher];

    return {
      annotation: request.annotation,
      behavior,
      isExpanded: behavior.defaultIsExpanded,
      kind: "agent",
      launcher: request.launcher,
      sessionId,
      summary: createAgentTerminalSummary(request),
    };
  }

  const behavior: ITerminalSessionBehavior = terminalBehaviorByEditorLauncher[request.launcher];

  return {
    behavior,
    componentName: request.componentName,
    isExpanded: behavior.defaultIsExpanded,
    kind: "editor",
    launcher: request.launcher,
    sessionId,
    sourceLabel: request.sourceLabel,
    summary: createEditorTerminalSummary(request),
  };
}

function createAgentTerminalSummary(request: IStartAgentTerminalSessionRequest): ITerminalSessionSummary {
  return {
    eyebrow: "Annotation task",
    headline: request.annotation.comment,
    meta: [
      `${request.annotation.markers.length} markers`,
      request.annotation.title,
      new URL(request.annotation.url).host,
      new Date(request.annotation.submittedAt).toLocaleString(),
    ],
    terminalTitle: terminalTitleByAgentLauncher[request.launcher],
    trayTooltipPrimary: request.annotation.comment,
    trayTooltipSecondary: trayTooltipSecondaryByAgentLauncher[request.launcher],
  };
}

function createEditorTerminalSummary(request: IStartEditorTerminalSessionRequest): ITerminalSessionSummary {
  return {
    eyebrow: "Component source",
    headline: `<${request.componentName}>`,
    meta: [request.sourceLabel],
    terminalTitle: terminalTitleByEditorLauncher[request.launcher],
    trayTooltipPrimary: `<${request.componentName}>`,
    trayTooltipSecondary: request.sourceLabel,
  };
}
