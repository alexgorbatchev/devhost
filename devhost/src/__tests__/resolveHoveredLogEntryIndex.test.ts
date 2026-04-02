import { describe, expect, test } from "bun:test";

import type { ILogMinimapMark } from "../devtools/features/minimap/createLogMinimapMarks";
import { resolveHoveredLogEntryIndex } from "../devtools/features/minimap/resolveHoveredLogEntryIndex";

describe("resolveHoveredLogEntryIndex", () => {
  test("returns the closest visible row index for the mouse position", () => {
    const marks: ILogMinimapMark[] = [
      {
        entryIndex: 8,
        height: 2,
        id: 101,
        stream: "stdout",
        top: 12,
        width: 50,
      },
      {
        entryIndex: 9,
        height: 2,
        id: 102,
        stream: "stderr",
        top: 15,
        width: 60,
      },
      {
        entryIndex: 10,
        height: 2,
        id: 103,
        stream: "stdout",
        top: 18,
        width: 70,
      },
    ];

    expect(resolveHoveredLogEntryIndex(marks, 16)).toBe(1);
  });

  test("returns null when no marks are visible", () => {
    expect(resolveHoveredLogEntryIndex([], 10)).toBeNull();
  });
});
