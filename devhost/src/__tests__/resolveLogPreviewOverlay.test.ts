import { describe, expect, test } from "bun:test";

import type { ILogMinimapMark } from "../devtools/createLogMinimapMarks";
import type { ILogPreviewRange } from "../devtools/createLogPreviewRange";
import { resolveLogPreviewOverlay } from "../devtools/resolveLogPreviewOverlay";

describe("resolveLogPreviewOverlay", () => {
  test("returns overlay bounds for the visible preview range", () => {
    const marks: ILogMinimapMark[] = [
      {
        entryIndex: 7,
        height: 2,
        id: 1,
        stream: "stdout",
        top: 4,
        width: 50,
      },
      {
        entryIndex: 8,
        height: 2,
        id: 2,
        stream: "stdout",
        top: 7,
        width: 40,
      },
      {
        entryIndex: 9,
        height: 2,
        id: 3,
        stream: "stderr",
        top: 10,
        width: 60,
      },
      {
        entryIndex: 10,
        height: 2,
        id: 4,
        stream: "stdout",
        top: 13,
        width: 30,
      },
    ];
    const previewRange: ILogPreviewRange = {
      endIndex: 10,
      startIndex: 8,
    };

    expect(resolveLogPreviewOverlay(marks, previewRange)).toEqual({
      height: 5,
      top: 7,
    });
  });

  test("returns null when the preview range is fully outside the visible marks", () => {
    const marks: ILogMinimapMark[] = [
      {
        entryIndex: 1,
        height: 2,
        id: 1,
        stream: "stdout",
        top: 4,
        width: 50,
      },
    ];
    const previewRange: ILogPreviewRange = {
      endIndex: 5,
      startIndex: 3,
    };

    expect(resolveLogPreviewOverlay(marks, previewRange)).toBeNull();
  });
});
