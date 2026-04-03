import { describe, expect, test } from "bun:test";

import { shouldAutoRemoveTerminalSession } from "../shouldAutoRemoveTerminalSession";
import type { ITerminalSession } from "../types";

const PI_ANNOTATION_SESSION: ITerminalSession = {
  annotation: {
    comment: "Fix button",
    markers: [],
    stackName: "stack-a",
    submittedAt: 1,
    title: "Page A",
    url: "https://example.test/a",
  },
  isExpanded: true,
  kind: "pi-annotation",
  sessionId: "session-a",
};

const COMPONENT_SOURCE_SESSION: ITerminalSession = {
  componentName: "PrimaryButton",
  isExpanded: true,
  kind: "component-source",
  sessionId: "session-b",
  sourceLabel: "src/components/PrimaryButton.tsx:42:8",
};

describe("shouldAutoRemoveTerminalSession", () => {
  test("does not auto-remove a running component-source session", () => {
    expect(shouldAutoRemoveTerminalSession(COMPONENT_SOURCE_SESSION, false)).toBe(false);
  });

  test("auto-removes an exited component-source session", () => {
    expect(shouldAutoRemoveTerminalSession(COMPONENT_SOURCE_SESSION, true)).toBe(true);
  });

  test("does not auto-remove an exited Pi annotation session", () => {
    expect(shouldAutoRemoveTerminalSession(PI_ANNOTATION_SESSION, true)).toBe(false);
  });
});
