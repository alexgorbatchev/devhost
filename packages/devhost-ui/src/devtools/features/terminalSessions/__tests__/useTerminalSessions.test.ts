import assert from "node:assert";

import { describe, expect, test } from "bun:test";

import { appendStartedTerminalSessionIfNeeded } from "../appendStartedTerminalSessionIfNeeded";
import { createTerminalSession } from "../createTerminalSession";

describe("useTerminalSessions", () => {
  test("keeps the existing local session when the server returns a duplicate session id", () => {
    const existingSession = createTerminalSession(
      "session-1",
      {
        annotation: {
          comment: "First annotation",
          markers: [],
          stackName: "hello-stack",
          submittedAt: 1,
          title: "Example page",
          url: "https://example.test/page",
        },
        kind: "agent",
      },
      "Pi",
    );
    const duplicateResponseSession = createTerminalSession(
      "session-1",
      {
        annotation: {
          comment: "Second annotation",
          markers: [],
          stackName: "hello-stack",
          submittedAt: 2,
          title: "Another page",
          url: "https://example.test/another-page",
        },
        kind: "agent",
      },
      "Pi",
    );
    const currentSessions = [existingSession];

    const nextSessions = appendStartedTerminalSessionIfNeeded(currentSessions, duplicateResponseSession);

    expect(nextSessions).toBe(currentSessions);
    expect(nextSessions[0]).toBe(existingSession);
    assert(nextSessions[0]?.kind === "agent");
    expect(nextSessions[0].annotation.comment).toBe("First annotation");
  });
});
