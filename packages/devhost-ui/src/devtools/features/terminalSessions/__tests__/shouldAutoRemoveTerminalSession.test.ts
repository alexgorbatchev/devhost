import { describe, expect, test } from "bun:test";

import { createTerminalSession } from "../createTerminalSession";
import { shouldAutoRemoveTerminalSession } from "../shouldAutoRemoveTerminalSession";

const AGENT_TERMINAL_SESSION = createTerminalSession(
  "session-a",
  {
    annotation: {
      comment: "Fix button",
      markers: [],
      stackName: "stack-a",
      submittedAt: 1,
      title: "Page A",
      url: "https://example.test/a",
    },
    kind: "agent",
  },
  "Claude Code",
);

const EDITOR_TERMINAL_SESSION = createTerminalSession(
  "session-b",
  {
    componentName: "PrimaryButton",
    kind: "editor",
    launcher: "neovim",
    source: {
      columnNumber: 8,
      fileName: "src/components/PrimaryButton.tsx",
      lineNumber: 42,
    },
    sourceLabel: "src/components/PrimaryButton.tsx:42:8",
  },
  "Claude Code",
);

describe("shouldAutoRemoveTerminalSession", () => {
  test("does not auto-remove a running editor terminal session", () => {
    expect(shouldAutoRemoveTerminalSession(EDITOR_TERMINAL_SESSION, false)).toBe(false);
  });

  test("auto-removes an exited editor terminal session", () => {
    expect(shouldAutoRemoveTerminalSession(EDITOR_TERMINAL_SESSION, true)).toBe(true);
  });

  test("does not auto-remove an exited agent terminal session", () => {
    expect(shouldAutoRemoveTerminalSession(AGENT_TERMINAL_SESSION, true)).toBe(false);
  });
});
