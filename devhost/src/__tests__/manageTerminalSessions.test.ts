import { describe, expect, test } from "bun:test";

import { createTerminalSession } from "../devtools/features/terminalSessions/createTerminalSession";
import type { ITerminalSession } from "../devtools/features/terminalSessions/types";
import {
  appendTerminalSession,
  expandTerminalSession,
  minimizeTerminalSession,
  removeTerminalSession,
} from "../devtools/features/terminalSessions/manageTerminalSessions";

const FIRST_SESSION: ITerminalSession = createTerminalSession("session-a", {
  annotation: {
    comment: "First annotation",
    markers: [],
    stackName: "stack-a",
    submittedAt: 1,
    title: "Page A",
    url: "https://example.test/a",
  },
  kind: "agent",
  launcher: "pi",
});

const SECOND_SESSION: ITerminalSession = {
  ...createTerminalSession("session-b", {
    annotation: {
      comment: "Second annotation",
      markers: [],
      stackName: "stack-b",
      submittedAt: 2,
      title: "Page B",
      url: "https://example.test/b",
    },
    kind: "agent",
    launcher: "pi",
  }),
  isExpanded: true,
};

const THIRD_SESSION: ITerminalSession = {
  ...createTerminalSession("session-c", {
    componentName: "PrimaryButton",
    kind: "editor",
    launcher: "neovim",
    source: {
      columnNumber: 8,
      fileName: "src/components/PrimaryButton.tsx",
      lineNumber: 42,
    },
    sourceLabel: "src/components/PrimaryButton.tsx:42:8",
  }),
  isExpanded: false,
};

describe("manageTerminalSessions", () => {
  test("appends new sessions at the front of the tray order", () => {
    expect(appendTerminalSession([FIRST_SESSION, SECOND_SESSION], THIRD_SESSION)).toEqual([
      THIRD_SESSION,
      FIRST_SESSION,
      SECOND_SESSION,
    ]);
  });

  test("collapses existing expanded sessions when appending a new expanded session", () => {
    const expandedEditorSession: ITerminalSession = {
      ...THIRD_SESSION,
      isExpanded: true,
    };

    expect(appendTerminalSession([FIRST_SESSION, SECOND_SESSION], expandedEditorSession)).toEqual([
      expandedEditorSession,
      FIRST_SESSION,
      {
        ...SECOND_SESSION,
        isExpanded: false,
      },
    ]);
  });

  test("expands the requested session and collapses the others", () => {
    expect(expandTerminalSession([FIRST_SESSION, SECOND_SESSION, THIRD_SESSION], THIRD_SESSION.sessionId)).toEqual([
      FIRST_SESSION,
      {
        ...SECOND_SESSION,
        isExpanded: false,
      },
      {
        ...THIRD_SESSION,
        isExpanded: true,
      },
    ]);
  });

  test("keeps the current state when expanding an unknown session", () => {
    expect(expandTerminalSession([FIRST_SESSION, SECOND_SESSION], "missing-session")).toEqual([
      FIRST_SESSION,
      SECOND_SESSION,
    ]);
  });

  test("minimizes only the requested session", () => {
    expect(minimizeTerminalSession([FIRST_SESSION, SECOND_SESSION], SECOND_SESSION.sessionId)).toEqual([
      FIRST_SESSION,
      {
        ...SECOND_SESSION,
        isExpanded: false,
      },
    ]);
  });

  test("removes terminated sessions from the collection", () => {
    expect(removeTerminalSession([FIRST_SESSION, SECOND_SESSION, THIRD_SESSION], SECOND_SESSION.sessionId)).toEqual([
      FIRST_SESSION,
      THIRD_SESSION,
    ]);
  });
});
