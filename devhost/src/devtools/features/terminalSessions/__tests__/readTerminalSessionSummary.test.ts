import { describe, expect, test } from "bun:test";

import { readTerminalSessionSummary } from "../readTerminalSessionSummary";
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
  isExpanded: false,
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

describe("readTerminalSessionSummary", () => {
  test("returns the Pi annotation terminal summary", () => {
    expect(readTerminalSessionSummary(PI_ANNOTATION_SESSION)).toEqual({
      eyebrow: "Original annotation",
      headline: "Fix button",
      meta: ["0 markers", "Page A", "example.test", new Date(1).toLocaleString()],
      terminalTitle: "Pi terminal",
      trayTooltipPrimary: "Fix button",
    });
  });

  test("returns the component-source terminal summary", () => {
    expect(readTerminalSessionSummary(COMPONENT_SOURCE_SESSION)).toEqual({
      eyebrow: "Component source",
      headline: "<PrimaryButton>",
      meta: ["src/components/PrimaryButton.tsx:42:8"],
      terminalTitle: "Neovim",
      trayTooltipPrimary: "<PrimaryButton>",
      trayTooltipSecondary: "src/components/PrimaryButton.tsx:42:8",
    });
  });
});
