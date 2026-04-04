import { describe, expect, test } from "bun:test";

import type { ILogMinimapMark } from "../createLogMinimapMarks";
import { resolveHoveredLogRowIndex } from "../resolveHoveredLogRowIndex";

describe("resolveHoveredLogRowIndex", () => {
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

    expect(resolveHoveredLogRowIndex(marks, 16)).toBe(1);
  });

  test("returns null when no marks are visible", () => {
    expect(resolveHoveredLogRowIndex([], 10)).toBeNull();
  });
});
