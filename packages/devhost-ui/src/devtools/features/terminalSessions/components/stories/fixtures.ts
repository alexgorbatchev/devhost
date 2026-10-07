import { createTerminalSession } from "../../createTerminalSession";
import type { IAnnotationSubmitDetail } from "../../../annotationComposer/types";
import type { TerminalSession } from "../../types";

const fixture_annotation: IAnnotationSubmitDetail = {
  comment: "Fix button",
  markers: [],
  stackName: "story-stack",
  submittedAt: 1,
  title: "Cart — Acme Shop",
  url: "https://shop.example.test/cart",
};

export const fixture_agentSession: TerminalSession = {
  ...createTerminalSession({
    label: "Pi",
    request: {
      actionId: "agent",
      annotation: fixture_annotation,
      kind: "agent",
    },
    sessionId: "session-1",
  }),
  behavior: { defaultIsExpanded: false, isFullscreenExpanded: false, shouldAutoRemoveOnExit: false },
};

// The Storybook preview's mock terminal websocket emits an exit message for this session id.
export const fixture_finishedAgentSession: TerminalSession = {
  ...fixture_agentSession,
  sessionId: "session-finished",
};

export const fixture_contrastSession: TerminalSession = {
  ...fixture_agentSession,
  sessionId: "session-contrast",
};

export const fixture_fullscreenAgentSession: TerminalSession = {
  ...fixture_agentSession,
  behavior: { defaultIsExpanded: false, isFullscreenExpanded: true, shouldAutoRemoveOnExit: false },
  sessionId: "session-fullscreen",
};

export const fixture_commandSession: TerminalSession = createTerminalSession({
  label: "Create Ticket",
  request: {
    actionId: "create-ticket",
    annotation: fixture_annotation,
    kind: "command",
  },
  sessionId: "command-session-1",
});

export const fixture_editorSession: TerminalSession = createTerminalSession({
  request: {
    componentName: "PrimaryButton",
    kind: "editor",
    launcher: "neovim",
    source: { columnNumber: 3, fileName: "src/components/PrimaryButton.tsx", lineNumber: 12 },
    sourceLabel: "src/components/PrimaryButton.tsx:12:3",
  },
  sessionId: "editor-session-1",
});

export function factory_agentSessions(count: number): TerminalSession[] {
  return Array.from({ length: count }, (_, index: number): TerminalSession => {
    return {
      ...fixture_agentSession,
      sessionId: `agent-session-${index + 1}`,
      status: index % 3 === 0 ? "exited" : "running",
      summary: { ...fixture_agentSession.summary, chipLabel: `Agent ${index + 1}` },
    };
  });
}
