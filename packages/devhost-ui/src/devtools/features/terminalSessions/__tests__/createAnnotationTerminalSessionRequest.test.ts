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
        action: { id: "fix", kind: "agent", label: "Pi", queueEnabled: true },
        annotation,
        colorScheme: "light",
        targetSessionId: "session-1",
      }),
    ).toEqual({
      actionId: "fix",
      annotation,
      colorScheme: "light",
      kind: "agent",
      targetSessionId: "session-1",
    });
  });

  test("leaves the color scheme off command requests", () => {
    expect(
      createAnnotationTerminalSessionRequest({
        action: { id: "log", kind: "command", label: "Log it", queueEnabled: false },
        annotation,
        colorScheme: "dark",
        targetSessionId: "session-1",
      }),
    ).toEqual({
      actionId: "log",
      annotation,
      kind: "command",
    });
  });
});
