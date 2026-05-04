import type {
  EditorTerminalLauncher,
  IAgentTerminalSession,
  ICommandTerminalSession,
  IEditorTerminalSession,
  IStartAgentTerminalSessionRequest,
  IStartCommandTerminalSessionRequest,
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

const commandTerminalBehavior: ITerminalSessionBehavior = {
  defaultIsExpanded: true,
  isFullscreenExpanded: true,
  shouldAutoRemoveOnExit: true,
};

const terminalBehaviorByEditorLauncher: Record<EditorTerminalLauncher, ITerminalSessionBehavior> = {
  neovim: {
    defaultIsExpanded: true,
    isFullscreenExpanded: true,
    shouldAutoRemoveOnExit: true,
  },
};

const agentTerminalTitle: string = "Agent terminal";
const commandTerminalTitle: string = "Annotation command";

const terminalTitleByEditorLauncher: Record<EditorTerminalLauncher, string> = {
  neovim: "Neovim",
};

export function createTerminalSession(sessionId: string, request: StartTerminalSessionRequest): TerminalSession {
  if (request.kind === "agent") {
    return {
      actionId: request.actionId,
      annotation: request.annotation,
      behavior: agentTerminalBehavior,
      displayName: request.displayName,
      isExpanded: agentTerminalBehavior.defaultIsExpanded,
      kind: "agent",
      sessionId,
      summary: createAgentTerminalSummary(request),
    } satisfies IAgentTerminalSession;
  }

  if (request.kind === "command") {
    return {
      actionId: request.actionId,
      annotation: request.annotation,
      behavior: commandTerminalBehavior,
      displayName: request.displayName,
      isExpanded: commandTerminalBehavior.defaultIsExpanded,
      kind: "command",
      sessionId,
      summary: createCommandTerminalSummary(request),
    } satisfies ICommandTerminalSession;
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

function createAgentTerminalSummary(request: IStartAgentTerminalSessionRequest): ITerminalSessionSummary {
  return {
    eyebrow: request.displayName,
    headline: "Agent session",
    meta: [
      `${request.annotation.markers.length} initial markers`,
      request.annotation.title,
      new URL(request.annotation.url).host,
      new Date(request.annotation.submittedAt).toLocaleString(),
    ],
    terminalTitle: agentTerminalTitle,
    trayTooltipPrimary: "Agent session",
    trayTooltipSecondary: request.displayName,
  };
}

function createCommandTerminalSummary(request: IStartCommandTerminalSessionRequest): ITerminalSessionSummary {
  return {
    eyebrow: request.displayName,
    headline: "Annotation command",
    meta: [
      `${request.annotation.markers.length} initial markers`,
      request.annotation.title,
      new URL(request.annotation.url).host,
      new Date(request.annotation.submittedAt).toLocaleString(),
    ],
    terminalTitle: commandTerminalTitle,
    trayTooltipPrimary: "Annotation command",
    trayTooltipSecondary: request.displayName,
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
