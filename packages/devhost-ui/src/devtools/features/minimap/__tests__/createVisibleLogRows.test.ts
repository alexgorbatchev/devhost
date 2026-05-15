import { describe, expect, test } from "bun:test";

import { createVisibleLogRows } from "../createVisibleLogRows";
import type { ServiceLogEntry } from "../../../shared/types";

describe("createVisibleLogRows", () => {
  test("keeps one visible row per log entry and clips width instead of wrapping", () => {
    const entries: ServiceLogEntry[] = [
      {
        id: 1,
        line: "x".repeat(90),
        serviceName: "api",
        stream: "stderr",
      },
    ];

    expect(createVisibleLogRows(entries, 8, 100)).toEqual([
      {
        entryIndex: 0,
        height: 2,
        fragments: [
          {
            backgroundColor: null,
            foregroundColor: null,
            isBold: false,
            isDim: false,
            isItalic: false,
            isStrikethrough: false,
            isUnderline: false,
            text: "x".repeat(90),
          },
        ],
        id: 1,
        stream: "stderr",
        text: "x".repeat(90),
        top: 6,
        width: 100,
      },
    ]);
  });

  test("measures ANSI log rows by visible text instead of raw escape sequences", () => {
    const entries: ServiceLogEntry[] = [
      {
        id: 1,
        line: "\u001b[38;2;12;34;56mwarn\u001b[0m",
        serviceName: "api",
        stream: "stdout",
      },
    ];

    expect(createVisibleLogRows(entries, 8, 100)).toEqual([
      {
        entryIndex: 0,
        height: 2,
        fragments: [
          {
            backgroundColor: null,
            foregroundColor: "rgb(12, 34, 56)",
            isBold: false,
            isDim: false,
            isItalic: false,
            isStrikethrough: false,
            isUnderline: false,
            text: "warn",
          },
        ],
        id: 1,
        stream: "stdout",
        text: "warn",
        top: 6,
        width: 12,
      },
    ]);
  });
});
