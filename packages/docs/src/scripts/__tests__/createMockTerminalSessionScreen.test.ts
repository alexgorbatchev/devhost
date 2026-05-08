import { describe, expect, it } from "bun:test";

import { createMockTerminalSessionScreen } from "../createMockTerminalSessionScreen";

const agentStatusPrefix = "\u001b]1337;SetAgentStatus=working\u0007";

describe("createMockTerminalSessionScreen", () => {
  it("renders a populated agent session screen", () => {
    const screen = createMockTerminalSessionScreen({
      comment: "Pin #1 under the health badge and align #2 with the launch command rail.",
      displayName: "Pi",
      kind: "agent",
      markerCount: 2,
      title: "MarketingCapturePage",
    });

    expect(screen.slice(0, agentStatusPrefix.length)).toBe(agentStatusPrefix);
    expect(readTerminalLines(screen).slice(-10)).toEqual([
      "  Comment: Pin #1 under the health badge and align #2 with the launch command rail.",
      "Plan",
      "  [1/3] Verify the selected markers map to distinct DOM targets.",
      "  [2/3] Refresh the marketing replay artifacts.",
      "  [3/3] Validate cursor transitions and annotation previews.",
      "Recent notes",
      "  - Agent status hook is active for the tray preview.",
      "  - Secondary annotation is queued for submission.",
      "  - Waiting for the next capture instruction.",
      "~/devhost/docs-demo $",
    ]);
  });

  it("renders a populated Neovim screen with absolute line numbers by default", () => {
    const screen = createMockTerminalSessionScreen({
      componentName: "CaptureSourceCardSurface",
      kind: "editor",
      sourceLabel: "src/components/CaptureSourceCardSurface.tsx:1:1",
      variant: "default",
    });

    expect(readTerminalLines(screen).slice(-6)).toEqual([
      ' 12   return <section data-testid="CaptureSourceContent">',
      " 13     <CaptureSourceCard className={captureCardClassName} />",
      " 14   </section>;",
      " 15 }",
      " 16",
      "NORMAL  CaptureSourceCardSurface.tsx [+]                                     utf-8                           12:5",
    ]);
  });

  it("renders an updated Neovim screen when relative number mode is enabled", () => {
    const screen = createMockTerminalSessionScreen({
      componentName: "CaptureSourceCardSurface",
      kind: "editor",
      sourceLabel: "src/components/CaptureSourceCardSurface.tsx:1:1",
      variant: "relative-number",
    });

    expect(readTerminalLines(screen).slice(-7)).toEqual([
      ' 12   return <section data-testid="CaptureSourceContent">',
      "  1     <CaptureSourceCard className={captureCardClassName} />",
      "  2   </section>;",
      "  3 }",
      "  4",
      "NORMAL  CaptureSourceCardSurface.tsx [+]                               relativenumber                        12:5",
      ":set relativenumber",
    ]);
  });
});

function readTerminalLines(value: string): string[] {
  const withoutOperatingSystemCommands = value.replace(/\u001b\][^\u0007]*\u0007/g, "");
  const withoutControlSequences = withoutOperatingSystemCommands.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");

  return withoutControlSequences
    .split("\r\n")
    .map((line: string): string => line.trimEnd())
    .filter((line: string): boolean => line.length > 0);
}
