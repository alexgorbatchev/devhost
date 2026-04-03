import { describe, expect, test } from "bun:test";

import type { ITerminalSession } from "../devtools/features/piTerminal/types";
import {
  appendPiTerminalSession,
  expandPiTerminalSession,
  minimizePiTerminalSession,
  removePiTerminalSession,
} from "../devtools/features/piTerminal/managePiTerminalSessions";

const FIRST_SESSION: ITerminalSession = {
  annotation: {
    comment: "First annotation",
    markers: [],
    stackName: "stack-a",
    submittedAt: 1,
    title: "Page A",
    url: "https://example.test/a",
  },
  isExpanded: false,
  kind: "pi-annotation",
  sessionId: "session-a",
};
const SECOND_SESSION: ITerminalSession = {
  annotation: {
    comment: "Second annotation",
    markers: [],
    stackName: "stack-b",
    submittedAt: 2,
    title: "Page B",
    url: "https://example.test/b",
  },
  isExpanded: true,
  kind: "pi-annotation",
  sessionId: "session-b",
};
const THIRD_SESSION: ITerminalSession = {
  componentName: "PrimaryButton",
  isExpanded: false,
  kind: "component-source",
  sessionId: "session-c",
  sourceLabel: "src/components/PrimaryButton.tsx:42:8",
};

describe("managePiTerminalSessions", () => {
  test("appends new sessions at the front of the tray order", () => {
    expect(appendPiTerminalSession([FIRST_SESSION, SECOND_SESSION], THIRD_SESSION)).toEqual([
      THIRD_SESSION,
      FIRST_SESSION,
      SECOND_SESSION,
    ]);
  });

  test("collapses existing expanded sessions when appending a new expanded session", () => {
    const expandedComponentSourceSession: ITerminalSession = {
      ...THIRD_SESSION,
      isExpanded: true,
    };

    expect(appendPiTerminalSession([FIRST_SESSION, SECOND_SESSION], expandedComponentSourceSession)).toEqual([
      expandedComponentSourceSession,
      FIRST_SESSION,
      {
        ...SECOND_SESSION,
        isExpanded: false,
      },
    ]);
  });

  test("expands the requested session and collapses the others", () => {
    expect(expandPiTerminalSession([FIRST_SESSION, SECOND_SESSION, THIRD_SESSION], THIRD_SESSION.sessionId)).toEqual([
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
    expect(expandPiTerminalSession([FIRST_SESSION, SECOND_SESSION], "missing-session")).toEqual([
      FIRST_SESSION,
      SECOND_SESSION,
    ]);
  });

  test("minimizes only the requested session", () => {
    expect(minimizePiTerminalSession([FIRST_SESSION, SECOND_SESSION], SECOND_SESSION.sessionId)).toEqual([
      FIRST_SESSION,
      {
        ...SECOND_SESSION,
        isExpanded: false,
      },
    ]);
  });

  test("removes terminated sessions from the collection", () => {
    expect(removePiTerminalSession([FIRST_SESSION, SECOND_SESSION, THIRD_SESSION], SECOND_SESSION.sessionId)).toEqual([
      FIRST_SESSION,
      THIRD_SESSION,
    ]);
  });
});
