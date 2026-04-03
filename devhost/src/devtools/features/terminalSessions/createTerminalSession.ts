import type {
  EditorTerminalLauncher,
  IAgentTerminalSession,
  IEditorTerminalSession,
  IStartAgentTerminalSessionRequest,
  IStartEditorTerminalSessionRequest,
  StartTerminalSessionRequest,
  TerminalSession,
  ITerminalSessionBehavior,
  ITerminalSessionSummary,
} from "./types";

const agentTerminalBehavior: ITerminalSessionBehavior = {
  defaultIsExpanded: false,
  isFullscreenExpanded: true,
  shouldAutoRemoveOnExit: false,
};

const terminalBehaviorByEditorLauncher: Record<EditorTerminalLauncher, ITerminalSessionBehavior> = {
  neovim: {
    defaultIsExpanded: true,
    isFullscreenExpanded: true,
    shouldAutoRemoveOnExit: true,
  },
};

const agentTerminalTitle: string = "Agent terminal";

const terminalTitleByEditorLauncher: Record<EditorTerminalLauncher, string> = {
  neovim: "Neovim",
};

export function createTerminalSession(
  sessionId: string,
  request: StartTerminalSessionRequest,
  agentDisplayName: string,
): TerminalSession {
  if (request.kind === "agent") {
    return {
      annotation: request.annotation,
      behavior: agentTerminalBehavior,
      displayName: agentDisplayName,
      isExpanded: agentTerminalBehavior.defaultIsExpanded,
      kind: "agent",
      sessionId,
      summary: createAgentTerminalSummary(request, agentDisplayName),
    } satisfies IAgentTerminalSession;
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
  } satisfies IEditorTerminalSession;
}

function createAgentTerminalSummary(
  request: IStartAgentTerminalSessionRequest,
  agentDisplayName: string,
): ITerminalSessionSummary {
  return {
    eyebrow: "Annotation task",
    headline: request.annotation.comment,
    meta: [
      `${request.annotation.markers.length} markers`,
      request.annotation.title,
      new URL(request.annotation.url).host,
      new Date(request.annotation.submittedAt).toLocaleString(),
    ],
    terminalTitle: agentTerminalTitle,
    trayTooltipPrimary: request.annotation.comment,
    trayTooltipSecondary: agentDisplayName,
  };
}

function createEditorTerminalSummary(request: IStartEditorTerminalSessionRequest): ITerminalSessionSummary {
  return {
    eyebrow: "Component source",
    headline: `<${request.componentName}>`,
    meta: [formatRawSourceLocation(request)],
    terminalTitle: terminalTitleByEditorLauncher[request.launcher],
    trayTooltipPrimary: `<${request.componentName}>`,
    trayTooltipSecondary: request.sourceLabel,
  };
}

function formatRawSourceLocation(request: IStartEditorTerminalSessionRequest): string {
  const columnSuffix: string = request.source.columnNumber === undefined ? "" : `:${request.source.columnNumber}`;

  return `${request.source.fileName}:${request.source.lineNumber}${columnSuffix}`;
}
