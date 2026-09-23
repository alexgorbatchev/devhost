import { describe, expect, test } from "bun:test";

import { createTerminalSession } from "../createTerminalSession";
import { pickVisibleTerminalSessions } from "../pickVisibleTerminalSessions";
import type { TerminalSession, TerminalSessionStatus } from "../types";

function createAgentSession(sessionId: string, status: TerminalSessionStatus): TerminalSession {
  return {
    ...createTerminalSession(sessionId, {
      actionId: "agent",
      annotation: {
        comment: "Annotation",
        markers: [],
        stackName: "stack",
        submittedAt: 1,
        title: "Page",
        url: "https://example.test/",
      },
      displayName: "Claude",
      kind: "agent",
    }),
    isExpanded: false,
    status,
  };
}

// Session collections are ordered newest first (see appendTerminalSession).
const newestExited: TerminalSession = createAgentSession("newest-exited", "exited");
const running: TerminalSession = createAgentSession("running", "working");
const olderExited: TerminalSession = createAgentSession("older-exited", "exited");
const oldestRunning: TerminalSession = createAgentSession("oldest-running", "running");
const sessions: TerminalSession[] = [newestExited, running, olderExited, oldestRunning];

describe("pickVisibleTerminalSessions", () => {
  test("keeps every session when the limit covers them all", () => {
    expect(pickVisibleTerminalSessions(sessions, Number.POSITIVE_INFINITY)).toBe(sessions);
  });

  test("prefers live sessions over exited ones and keeps collection order", () => {
    expect(pickVisibleTerminalSessions(sessions, 2).map((session: TerminalSession) => session.sessionId)).toEqual([
      "running",
      "oldest-running",
    ]);
  });

  test("always keeps the expanded session first in priority", () => {
    const expandedExited: TerminalSession = { ...olderExited, isExpanded: true };

    expect(
      pickVisibleTerminalSessions([newestExited, running, expandedExited, oldestRunning], 2).map(
        (session: TerminalSession) => session.sessionId,
      ),
    ).toEqual(["running", "older-exited"]);
  });

  test("falls back to the newest exited sessions once live sessions are exhausted", () => {
    expect(pickVisibleTerminalSessions(sessions, 3).map((session: TerminalSession) => session.sessionId)).toEqual([
      "newest-exited",
      "running",
      "oldest-running",
    ]);
  });

  test("returns no sessions for a zero limit", () => {
    expect(pickVisibleTerminalSessions(sessions, 0)).toEqual([]);
  });
});
