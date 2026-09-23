import { describe, expect, test } from "bun:test";

import type { IAnnotationSubmitDetail } from "../../annotationComposer/types";
import { createAnnotationTerminalSessionRequest } from "../createAnnotationTerminalSessionRequest";

const annotation: IAnnotationSubmitDetail = {
  comment: "Fix button",
  markers: [],
  stackName: "stack-a",
  submittedAt: 1,
  title: "Page A",
  url: "https://example.test/a",
};

describe("createAnnotationTerminalSessionRequest", () => {
  test("carries the devtools color scheme and target session on agent requests", () => {
    expect(
      createAnnotationTerminalSessionRequest({
        action: { displayName: "Ask Pi", id: "fix", kind: "agent", queueEnabled: true },
        annotation,
        colorScheme: "light",
        targetSessionId: "session-1",
      }),
    ).toEqual({
      actionId: "fix",
      annotation,
      colorScheme: "light",
      displayName: "Ask Pi",
      kind: "agent",
      targetSessionId: "session-1",
    });
  });

  test("leaves the color scheme off command requests", () => {
    expect(
      createAnnotationTerminalSessionRequest({
        action: { displayName: "Log it", id: "log", kind: "command", queueEnabled: false },
        annotation,
        colorScheme: "dark",
        targetSessionId: "session-1",
      }),
    ).toEqual({
      actionId: "log",
      annotation,
      displayName: "Log it",
      kind: "command",
    });
  });
});
