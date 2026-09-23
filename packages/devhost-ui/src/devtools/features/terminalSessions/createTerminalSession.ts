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
      errorMessage: null,
      isExpanded: agentTerminalBehavior.defaultIsExpanded,
      kind: "agent",
      sessionId,
      status: "connecting",
      summary: createAgentTerminalSummary(request),
    } satisfies IAgentTerminalSession;
  }

  if (request.kind === "command") {
    return {
      actionId: request.actionId,
      annotation: request.annotation,
      behavior: commandTerminalBehavior,
      displayName: request.displayName,
      errorMessage: null,
      isExpanded: commandTerminalBehavior.defaultIsExpanded,
      kind: "command",
      sessionId,
      status: "connecting",
      summary: createCommandTerminalSummary(request),
    } satisfies ICommandTerminalSession;
  }

  const behavior: ITerminalSessionBehavior = terminalBehaviorByEditorLauncher[request.launcher];

  return {
    behavior,
    componentName: request.componentName,
    errorMessage: null,
    isExpanded: behavior.defaultIsExpanded,
    kind: "editor",
    launcher: request.launcher,
    sessionId,
    sourceLabel: request.sourceLabel,
    status: "connecting",
    summary: createEditorTerminalSummary(request),
  } satisfies IEditorTerminalSession;
}

function createAgentTerminalSummary(request: IStartAgentTerminalSessionRequest): ITerminalSessionSummary {
  return {
    chipLabel: request.displayName,
    meta: createAnnotationSummaryMeta(request),
    title: request.displayName,
  };
}

function createCommandTerminalSummary(request: IStartCommandTerminalSessionRequest): ITerminalSessionSummary {
  return {
    chipLabel: request.displayName,
    meta: createAnnotationSummaryMeta(request),
    title: request.displayName,
  };
}

function createEditorTerminalSummary(request: IStartEditorTerminalSessionRequest): ITerminalSessionSummary {
  const componentLabel: string = `<${request.componentName}>`;

  return {
    chipLabel: componentLabel,
    meta: [componentLabel, request.sourceLabel],
    title: terminalTitleByEditorLauncher[request.launcher],
  };
}

function createAnnotationSummaryMeta(
  request: IStartAgentTerminalSessionRequest | IStartCommandTerminalSessionRequest,
): string[] {
  return [
    `${request.annotation.markers.length} initial markers`,
    request.annotation.title,
    new URL(request.annotation.url).host,
    new Date(request.annotation.submittedAt).toLocaleString(),
  ];
}
