import { describe, expect, test } from "bun:test";

import { createTerminalSession } from "../createTerminalSession";
import { restoreTerminalSessions } from "../restoreTerminalSessions";
import type { IActiveTerminalSessionSnapshot, TerminalSession } from "../types";

const AGENT_SNAPSHOT: IActiveTerminalSessionSnapshot = {
  request: {
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
    const restoredSessions: TerminalSession[] = restoreTerminalSessions([], [AGENT_SNAPSHOT, EDITOR_SNAPSHOT], "Pi");

    expect(restoredSessions).toEqual([
      {
        ...createTerminalSession(EDITOR_SNAPSHOT.sessionId, EDITOR_SNAPSHOT.request, "Pi"),
        isExpanded: false,
      },
      {
        ...createTerminalSession(AGENT_SNAPSHOT.sessionId, AGENT_SNAPSHOT.request, "Pi"),
        isExpanded: false,
      },
    ]);
  });

  test("keeps the current expanded session and avoids duplicates", () => {
    const currentSessions: TerminalSession[] = [
      createTerminalSession("current-editor", EDITOR_SNAPSHOT.request, "Pi"),
      createTerminalSession(AGENT_SNAPSHOT.sessionId, AGENT_SNAPSHOT.request, "Pi"),
    ];
    const restoredSessions: TerminalSession[] = restoreTerminalSessions(
      currentSessions,
      [AGENT_SNAPSHOT, EDITOR_SNAPSHOT],
      "Pi",
    );

    expect(restoredSessions).toEqual([
      createTerminalSession("current-editor", EDITOR_SNAPSHOT.request, "Pi"),
      createTerminalSession(AGENT_SNAPSHOT.sessionId, AGENT_SNAPSHOT.request, "Pi"),
      {
        ...createTerminalSession(EDITOR_SNAPSHOT.sessionId, EDITOR_SNAPSHOT.request, "Pi"),
        isExpanded: false,
      },
    ]);
  });
});
