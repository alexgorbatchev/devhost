import assert from "node:assert";

import { describe, expect, test } from "bun:test";

import { createTerminalSession } from "../createTerminalSession";
import { restoreTerminalSessions } from "../restoreTerminalSessions";
import type { ActiveTerminalSessionSnapshot, TerminalSession } from "../types";

// The control server lists an annotation session with the label its action had when the session started.
const AGENT_SNAPSHOT: ActiveTerminalSessionSnapshot = {
  label: "Pi",
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

const EDITOR_SNAPSHOT: ActiveTerminalSessionSnapshot = {
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
    const restoredSessions: TerminalSession[] = restoreTerminalSessions([], [AGENT_SNAPSHOT, EDITOR_SNAPSHOT]);

    expect(restoredSessions).toEqual([
      {
        ...createTerminalSession(EDITOR_SNAPSHOT),
        isExpanded: false,
      },
      {
        ...createTerminalSession(AGENT_SNAPSHOT),
        isExpanded: false,
      },
    ]);
  });

  test("labels a restored annotation session with the label the server listed", () => {
    const restoredSessions: TerminalSession[] = restoreTerminalSessions([], [AGENT_SNAPSHOT]);
    const restoredSession: TerminalSession | undefined = restoredSessions[0];

    assert(restoredSession !== undefined);
    expect(restoredSession.summary.chipLabel).toBe("Pi");
    expect(restoredSession.summary.title).toBe("Pi");
  });

  test("keeps the current expanded session and avoids duplicates", () => {
    const currentSessions: TerminalSession[] = [
      createTerminalSession({ ...EDITOR_SNAPSHOT, sessionId: "current-editor" }),
      createTerminalSession(AGENT_SNAPSHOT),
    ];
    const restoredSessions: TerminalSession[] = restoreTerminalSessions(currentSessions, [
      AGENT_SNAPSHOT,
      EDITOR_SNAPSHOT,
    ]);

    expect(restoredSessions).toEqual([
      createTerminalSession({ ...EDITOR_SNAPSHOT, sessionId: "current-editor" }),
      createTerminalSession(AGENT_SNAPSHOT),
      {
        ...createTerminalSession(EDITOR_SNAPSHOT),
        isExpanded: false,
      },
    ]);
  });
});
