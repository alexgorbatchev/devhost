import { describe, expect, test } from "bun:test";

import type { IAnnotationAction } from "../../../shared/devtoolsConfig";
import { createTerminalSession } from "../createTerminalSession";

const ANNOTATION_ACTIONS: IAnnotationAction[] = [
  { id: "fix", kind: "agent", label: "Claude Code", queueEnabled: true },
  { id: "ticket", kind: "command", label: "Create Ticket", queueEnabled: false },
];

describe("createTerminalSession", () => {
  test("creates an agent terminal session labelled with its configured action", () => {
    expect(
      createTerminalSession(
        "session-a",
        {
          actionId: "fix",
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
        ANNOTATION_ACTIONS,
      ),
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
      createTerminalSession(
        "session-command",
        {
          actionId: "ticket",
          annotation: {
            comment: "Create a ticket",
            markers: [],
            stackName: "stack-a",
            submittedAt: 2,
            title: "Page B",
            url: "https://example.test/b",
          },
          kind: "command",
        },
        ANNOTATION_ACTIONS,
      ),
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

  test("labels an annotation session with its action id when the action is not configured", () => {
    const terminalSession = createTerminalSession(
      "session-unknown",
      {
        actionId: "removed-action",
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
      ANNOTATION_ACTIONS,
    );

    expect(terminalSession.summary.chipLabel).toBe("removed-action");
    expect(terminalSession.summary.title).toBe("removed-action");
  });

  test("creates an editor terminal session with launcher-specific summary and behavior", () => {
    expect(
      createTerminalSession(
        "session-b",
        {
          componentName: "PrimaryButton",
          kind: "editor",
          launcher: "neovim",
          source: {
            columnNumber: 8,
            fileName: "webpack:///./src/components/PrimaryButton.tsx",
            lineNumber: 42,
          },
          sourceLabel: "src/components/PrimaryButton.tsx:42:8",
        },
        ANNOTATION_ACTIONS,
      ),
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
