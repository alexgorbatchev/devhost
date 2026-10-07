import { describe, expect, test } from "bun:test";

import { isListTerminalSessionsResponse } from "../isListTerminalSessionsResponse";

const ANNOTATION = {
  comment: "Investigate the broken save state",
  markers: [],
  stackName: "hello-stack",
  submittedAt: 1_735_689_600_000,
  title: "Save state drift",
  url: "https://example.com/app",
};

describe("isListTerminalSessionsResponse", () => {
  test("accepts the session list the control server returns", () => {
    // Each entry mirrors the JSON of activeTerminalSessionSnapshot in apps/devhost/internal/devtools/terminal.go.
    expect(
      isListTerminalSessionsResponse({
        sessions: [
          {
            label: "Claude Code",
            request: { actionId: "fix", annotation: ANNOTATION, colorScheme: "dark", kind: "agent" },
            sessionId: "agent-session",
          },
          {
            label: "Run lint",
            request: { actionId: "lint", annotation: ANNOTATION, kind: "command" },
            sessionId: "command-session",
          },
          {
            request: {
              componentName: "SaveButton",
              kind: "editor",
              launcher: "neovim",
              pageUrl: "https://example.com/app",
              source: { fileName: "src/components/SaveButton.tsx", lineNumber: 42 },
              sourceLabel: "src/components/SaveButton.tsx:42",
            },
            sessionId: "editor-session",
          },
        ],
      }),
    ).toBe(true);
  });

  test("rejects an annotation session without a label", () => {
    expect(
      isListTerminalSessionsResponse({
        sessions: [{ request: { actionId: "fix", annotation: ANNOTATION, kind: "agent" }, sessionId: "agent-session" }],
      }),
    ).toBe(false);
  });

  test("rejects a session whose request has no annotation", () => {
    expect(
      isListTerminalSessionsResponse({
        sessions: [{ label: "Claude Code", request: { actionId: "fix", kind: "agent" }, sessionId: "agent-session" }],
      }),
    ).toBe(false);
  });

  test("rejects a response without a session list", () => {
    expect(isListTerminalSessionsResponse({ sessions: null })).toBe(false);
  });
});
