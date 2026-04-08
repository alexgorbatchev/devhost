import { describe, expect, test } from "bun:test";

import { createTerminalSession } from "../createTerminalSession";
import { resolveTerminalPanelLayout } from "../resolveTerminalPanelLayout";

const AGENT_TERMINAL_BEHAVIOR = createTerminalSession(
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
).behavior;

const EDITOR_TERMINAL_BEHAVIOR = createTerminalSession(
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
).behavior;

describe("resolveTerminalPanelLayout", () => {
  test("expands agent terminal sessions to the full viewport", () => {
    expect(resolveTerminalPanelLayout(AGENT_TERMINAL_BEHAVIOR, 1600, 1000)).toEqual({
      expandedPanelSize: {
        height: 1000,
        width: 1600,
      },
      isFullscreenExpanded: true,
      trayPanelSize: {
        height: 720,
        width: 1040,
      },
    });
  });

  test("expands editor terminal sessions to the full viewport", () => {
    expect(resolveTerminalPanelLayout(EDITOR_TERMINAL_BEHAVIOR, 1600, 1000)).toEqual({
      expandedPanelSize: {
        height: 1000,
        width: 1600,
      },
      isFullscreenExpanded: true,
      trayPanelSize: {
        height: 720,
        width: 1040,
      },
    });
  });

  test("keeps small viewports above the minimum tray size", () => {
    expect(resolveTerminalPanelLayout(EDITOR_TERMINAL_BEHAVIOR, 200, 180)).toEqual({
      expandedPanelSize: {
        height: 180,
        width: 200,
      },
      isFullscreenExpanded: true,
      trayPanelSize: {
        height: 240,
        width: 320,
      },
    });
  });
});
