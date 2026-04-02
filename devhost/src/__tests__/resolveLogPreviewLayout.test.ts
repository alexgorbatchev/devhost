import { describe, expect, test } from "bun:test";

import type { ILogMinimapMark } from "../devtools/features/minimap/createLogMinimapMarks";
import { resolveLogPreviewLayout } from "../devtools/features/minimap/resolveLogPreviewLayout";

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

function createBottomAnchoredMarks(rowCount: number, viewportHeight: number): ILogMinimapMark[] {
  return Array.from({ length: rowCount }, (_, index: number): ILogMinimapMark => {
    return createMark(viewportHeight - 2 - (rowCount - index - 1) * 3, index);
  });
}

describe("resolveLogPreviewLayout", () => {
  test("follows the hovered row on the y axis when there is room to move", () => {
    const marks: ILogMinimapMark[] = Array.from({ length: 200 }, (_, index: number): ILogMinimapMark => {
      return createMark(index * 3, index);
    });

    expect(
      resolveLogPreviewLayout({
        borderWidth: 1,
        hoveredRowIndex: 120,
        marks,
        previewPadding: 8,
        rowGap: 0,
        rowHeight: 24,
        viewportHeight: 700,
        viewportPadding: 10,
      }),
    ).toEqual({
      range: {
        endIndex: 131,
        startIndex: 110,
      },
      top: 100,
    });
  });

  test("clamps the preview to the viewport when centering would push it off-screen", () => {
    const marks: ILogMinimapMark[] = Array.from({ length: 200 }, (_, index: number): ILogMinimapMark => {
      return createMark(index * 3, index);
    });

    expect(
      resolveLogPreviewLayout({
        borderWidth: 1,
        hoveredRowIndex: 1,
        marks,
        previewPadding: 8,
        rowGap: 0,
        rowHeight: 24,
        viewportHeight: 700,
        viewportPadding: 10,
      }),
    ).toEqual({
      range: {
        endIndex: 21,
        startIndex: 0,
      },
      top: 10,
    });
  });

  test("centers the preview window around early visible rows when viewport room is available", () => {
    const marks: ILogMinimapMark[] = Array.from({ length: 60 }, (_, index: number): ILogMinimapMark => {
      return createMark(300 + index * 3, index);
    });

    expect(
      resolveLogPreviewLayout({
        borderWidth: 1,
        hoveredRowIndex: 1,
        marks,
        previewPadding: 8,
        rowGap: 0,
        rowHeight: 24,
        viewportHeight: 1200,
        viewportPadding: 10,
      }),
    ).toEqual({
      range: {
        endIndex: 21,
        startIndex: 0,
      },
      top: 43,
    });

    expect(
      resolveLogPreviewLayout({
        borderWidth: 1,
        hoveredRowIndex: 5,
        marks,
        previewPadding: 8,
        rowGap: 0,
        rowHeight: 24,
        viewportHeight: 1200,
        viewportPadding: 10,
      }),
    ).toEqual({
      range: {
        endIndex: 21,
        startIndex: 0,
      },
      top: 55,
    });
  });

  test("keeps the preview clamped to the viewport bottom when the centered window is clamped at the end", () => {
    const marks: ILogMinimapMark[] = createBottomAnchoredMarks(60, 700);

    expect(
      resolveLogPreviewLayout({
        borderWidth: 1,
        hoveredRowIndex: 58,
        marks,
        previewPadding: 8,
        rowGap: 0,
        rowHeight: 24,
        viewportHeight: 700,
        viewportPadding: 10,
      }),
    ).toEqual({
      range: {
        endIndex: 60,
        startIndex: 39,
      },
      top: 168,
    });
  });
});
