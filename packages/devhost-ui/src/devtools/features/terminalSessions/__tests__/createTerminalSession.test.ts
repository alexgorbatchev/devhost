import { describe, expect, test } from "bun:test";

import { createTerminalSession } from "../createTerminalSession";

describe("createTerminalSession", () => {
  test("creates an agent terminal session with generic summary and behavior", () => {
    expect(
      createTerminalSession("session-a", {
        actionId: "fix",
        annotation: {
          comment: "Fix button",
          markers: [],
          stackName: "stack-a",
          submittedAt: 1,
          title: "Page A",
          url: "https://example.test/a",
        },
        displayName: "Claude Code",
        kind: "agent",
      }),
    ).toEqual({
      actionId: "fix",
      annotation: {
        comment: "Fix button",
        markers: [],
        stackName: "stack-a",
        submittedAt: 1,
        title: "Page A",
        url: "https://example.test/a",
      },
      behavior: {
        defaultIsExpanded: false,
        isFullscreenExpanded: true,
        shouldAutoRemoveOnExit: false,
      },
      displayName: "Claude Code",
      errorMessage: null,
      isExpanded: false,
      kind: "agent",
      sessionId: "session-a",
      status: "connecting",
      summary: {
        chipLabel: "Claude Code",
        meta: ["0 initial markers", "Page A", "example.test", new Date(1).toLocaleString()],
        title: "Claude Code",
      },
    });
  });

  test("creates a command terminal session with command-specific summary and behavior", () => {
    expect(
      createTerminalSession("session-command", {
        actionId: "ticket",
        annotation: {
          comment: "Create a ticket",
          markers: [],
          stackName: "stack-a",
          submittedAt: 2,
          title: "Page B",
          url: "https://example.test/b",
        },
        displayName: "Create Ticket",
        kind: "command",
      }),
    ).toEqual({
      actionId: "ticket",
      annotation: {
        comment: "Create a ticket",
        markers: [],
        stackName: "stack-a",
        submittedAt: 2,
        title: "Page B",
        url: "https://example.test/b",
      },
      behavior: {
        defaultIsExpanded: true,
        isFullscreenExpanded: true,
        shouldAutoRemoveOnExit: true,
      },
      displayName: "Create Ticket",
      errorMessage: null,
      isExpanded: true,
      kind: "command",
      sessionId: "session-command",
      status: "connecting",
      summary: {
        chipLabel: "Create Ticket",
        meta: ["0 initial markers", "Page B", "example.test", new Date(2).toLocaleString()],
        title: "Create Ticket",
      },
    });
  });

  test("creates an editor terminal session with launcher-specific summary and behavior", () => {
    expect(
      createTerminalSession("session-b", {
        componentName: "PrimaryButton",
        kind: "editor",
        launcher: "neovim",
        source: {
          columnNumber: 8,
          fileName: "webpack:///./src/components/PrimaryButton.tsx",
          lineNumber: 42,
        },
        sourceLabel: "src/components/PrimaryButton.tsx:42:8",
      }),
    ).toEqual({
      behavior: {
        defaultIsExpanded: true,
        isFullscreenExpanded: true,
        shouldAutoRemoveOnExit: true,
      },
      componentName: "PrimaryButton",
      errorMessage: null,
      isExpanded: true,
      kind: "editor",
      launcher: "neovim",
      sessionId: "session-b",
      sourceLabel: "src/components/PrimaryButton.tsx:42:8",
      status: "connecting",
      summary: {
        chipLabel: "<PrimaryButton>",
        meta: ["<PrimaryButton>", "src/components/PrimaryButton.tsx:42:8"],
        title: "Neovim",
      },
    });
  });
});
