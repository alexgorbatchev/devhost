import { describe, expect, test } from "bun:test";

import { createTerminalSession } from "../createTerminalSession";

describe("createTerminalSession", () => {
  test("creates an agent terminal session with generic summary and behavior", () => {
    expect(
      createTerminalSession(
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
      ),
    ).toEqual({
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
        isFullscreenExpanded: false,
        shouldAutoRemoveOnExit: false,
      },
      displayName: "Claude Code",
      isExpanded: false,
      kind: "agent",
      sessionId: "session-a",
      summary: {
        eyebrow: "Annotation task",
        headline: "Fix button",
        meta: ["0 markers", "Page A", "example.test", new Date(1).toLocaleString()],
        terminalTitle: "Agent terminal",
        trayTooltipPrimary: "Fix button",
        trayTooltipSecondary: "Claude Code",
      },
    });
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
        "Claude Code",
      ),
    ).toEqual({
      behavior: {
        defaultIsExpanded: true,
        isFullscreenExpanded: true,
        shouldAutoRemoveOnExit: true,
      },
      componentName: "PrimaryButton",
      isExpanded: true,
      kind: "editor",
      launcher: "neovim",
      sessionId: "session-b",
      sourceLabel: "src/components/PrimaryButton.tsx:42:8",
      summary: {
        eyebrow: "Component source",
        headline: "<PrimaryButton>",
        meta: ["src/components/PrimaryButton.tsx:42:8"],
        terminalTitle: "Neovim",
        trayTooltipPrimary: "<PrimaryButton>",
        trayTooltipSecondary: "src/components/PrimaryButton.tsx:42:8",
      },
    });
  });
});
