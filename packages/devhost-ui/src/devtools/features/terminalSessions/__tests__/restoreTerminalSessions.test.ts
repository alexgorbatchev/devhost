import assert from "node:assert";

import { describe, expect, test } from "bun:test";

import type { IAnnotationAction } from "../../../shared/devtoolsConfig";
import { createTerminalSession } from "../createTerminalSession";
import { restoreTerminalSessions } from "../restoreTerminalSessions";
import type { IActiveTerminalSessionSnapshot, TerminalSession } from "../types";

const ANNOTATION_ACTIONS: IAnnotationAction[] = [{ id: "agent", kind: "agent", label: "Pi", queueEnabled: true }];

// The control server lists a session's request without a label; the label comes from the configured actions.
const AGENT_SNAPSHOT: IActiveTerminalSessionSnapshot = {
  request: {
    actionId: "agent",
    annotation: {
      comment: "Investigate the broken save state",
      markers: [],
      stackName: "hello-stack",
      submittedAt: 1_735_689_600_000,
      title: "Save state drift",
      url: "https://example.com/app",
    },
    kind: "agent",
  },
  sessionId: "agent-session",
};

const EDITOR_SNAPSHOT: IActiveTerminalSessionSnapshot = {
  request: {
    componentName: "SaveButton",
    kind: "editor",
    launcher: "neovim",
    source: {
      columnNumber: 8,
      fileName: "src/components/SaveButton.tsx",
      lineNumber: 42,
    },
    sourceLabel: "src/components/SaveButton.tsx:42:8",
  },
  sessionId: "editor-session",
};

describe("restoreTerminalSessions", () => {
  test("restores missing sessions in newest-first order as minimized sessions", () => {
    const restoredSessions: TerminalSession[] = restoreTerminalSessions(
      [],
      [AGENT_SNAPSHOT, EDITOR_SNAPSHOT],
      ANNOTATION_ACTIONS,
    );

    expect(restoredSessions).toEqual([
      {
        ...createTerminalSession(EDITOR_SNAPSHOT.sessionId, EDITOR_SNAPSHOT.request, ANNOTATION_ACTIONS),
        isExpanded: false,
      },
      {
        ...createTerminalSession(AGENT_SNAPSHOT.sessionId, AGENT_SNAPSHOT.request, ANNOTATION_ACTIONS),
        isExpanded: false,
      },
    ]);
  });

  test("labels a restored annotation session with its configured action label", () => {
    const restoredSessions: TerminalSession[] = restoreTerminalSessions([], [AGENT_SNAPSHOT], ANNOTATION_ACTIONS);
    const restoredSession: TerminalSession | undefined = restoredSessions[0];

    assert(restoredSession !== undefined);
    expect(restoredSession.summary.chipLabel).toBe("Pi");
    expect(restoredSession.summary.title).toBe("Pi");
  });

  test("keeps the current expanded session and avoids duplicates", () => {
    const currentSessions: TerminalSession[] = [
      createTerminalSession("current-editor", EDITOR_SNAPSHOT.request, ANNOTATION_ACTIONS),
      createTerminalSession(AGENT_SNAPSHOT.sessionId, AGENT_SNAPSHOT.request, ANNOTATION_ACTIONS),
    ];
    const restoredSessions: TerminalSession[] = restoreTerminalSessions(
      currentSessions,
      [AGENT_SNAPSHOT, EDITOR_SNAPSHOT],
      ANNOTATION_ACTIONS,
    );

    expect(restoredSessions).toEqual([
      createTerminalSession("current-editor", EDITOR_SNAPSHOT.request, ANNOTATION_ACTIONS),
      createTerminalSession(AGENT_SNAPSHOT.sessionId, AGENT_SNAPSHOT.request, ANNOTATION_ACTIONS),
      {
        ...createTerminalSession(EDITOR_SNAPSHOT.sessionId, EDITOR_SNAPSHOT.request, ANNOTATION_ACTIONS),
        isExpanded: false,
      },
    ]);
  });
});
