import type {
  ActiveTerminalSessionSnapshot,
  AnnotationTerminalSession,
  EditorTerminalLauncher,
  IActiveAnnotationTerminalSessionSnapshot,
  IAgentTerminalSession,
  ICommandTerminalSession,
  IEditorTerminalSession,
  IStartEditorTerminalSessionRequest,
  StartAnnotationTerminalSessionRequest,
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

export function createTerminalSession(snapshot: ActiveTerminalSessionSnapshot): TerminalSession {
  if ("label" in snapshot) {
    return createAnnotationTerminalSession(snapshot);
  }

  const { request, sessionId } = snapshot;
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

function createAnnotationTerminalSession({
  label,
  request,
  sessionId,
}: IActiveAnnotationTerminalSessionSnapshot): AnnotationTerminalSession {
  const summary: ITerminalSessionSummary = {
    chipLabel: label,
    meta: createAnnotationSummaryMeta(request),
    title: label,
  };

  if (request.kind === "agent") {
    return {
      actionId: request.actionId,
      annotation: request.annotation,
      behavior: agentTerminalBehavior,
      errorMessage: null,
      isExpanded: agentTerminalBehavior.defaultIsExpanded,
      kind: "agent",
      sessionId,
      status: "connecting",
      summary,
    } satisfies IAgentTerminalSession;
  }

  return {
    actionId: request.actionId,
    annotation: request.annotation,
    behavior: commandTerminalBehavior,
    errorMessage: null,
    isExpanded: commandTerminalBehavior.defaultIsExpanded,
    kind: "command",
    sessionId,
    status: "connecting",
    summary,
  } satisfies ICommandTerminalSession;
}

function createEditorTerminalSummary(request: IStartEditorTerminalSessionRequest): ITerminalSessionSummary {
  const componentLabel: string = `<${request.componentName}>`;

  return {
    chipLabel: componentLabel,
    meta: [componentLabel, request.sourceLabel],
    title: terminalTitleByEditorLauncher[request.launcher],
  };
}

function createAnnotationSummaryMeta(request: StartAnnotationTerminalSessionRequest): string[] {
  return [
    `${request.annotation.markers.length} initial markers`,
    request.annotation.title,
    new URL(request.annotation.url).host,
    new Date(request.annotation.submittedAt).toLocaleString(),
  ];
}
