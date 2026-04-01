import { describe, expect, test } from "bun:test";

import type { ILogMinimapMark } from "../devtools/createLogMinimapMarks";
import { resolveLogPreviewLayout } from "../devtools/resolveLogPreviewLayout";

function createMark(top: number, entryIndex: number): ILogMinimapMark {
  return {
    entryIndex,
    height: 2,
    id: entryIndex + 1,
    stream: entryIndex % 2 === 0 ? "stdout" : "stderr",
    top,
    width: 60,
  };
}

describe("resolveLogPreviewLayout", () => {
  test("follows the hovered row on the y axis when there is room to move", () => {
    const marks: ILogMinimapMark[] = Array.from({ length: 100 }, (_, index: number): ILogMinimapMark => {
      return createMark(index * 3, index);
    });

    expect(
      resolveLogPreviewLayout({
        borderWidth: 1,
        hoveredRowIndex: 60,
        marks,
        previewPadding: 8,
        rowGap: 4,
        rowHeight: 24,
        viewportHeight: 600,
        viewportPadding: 10,
      }),
    ).toEqual({
      range: {
        endIndex: 66,
        startIndex: 55,
      },
      top: 20,
    });
  });

  test("clamps the preview to the viewport when centering would push it off-screen", () => {
    const marks: ILogMinimapMark[] = Array.from({ length: 100 }, (_, index: number): ILogMinimapMark => {
      return createMark(index * 3, index);
    });

    expect(
      resolveLogPreviewLayout({
        borderWidth: 1,
        hoveredRowIndex: 1,
        marks,
        previewPadding: 8,
        rowGap: 4,
        rowHeight: 24,
        viewportHeight: 600,
        viewportPadding: 10,
      }),
    ).toEqual({
      range: {
        endIndex: 11,
        startIndex: 0,
      },
      top: 10,
    });
  });
});
