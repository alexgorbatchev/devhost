import { describe, expect, test } from "bun:test";

import type { ServiceLogStream } from "../devtools/shared/types";
import type { IVisibleLogRow } from "../devtools/features/minimap/createVisibleLogRows";
import { createLogPreviewWindow } from "../devtools/features/minimap/createLogPreviewWindow";

const logStreams: ServiceLogStream[] = ["stdout", "stderr"];

function createRow(id: number): IVisibleLogRow {
  return {
    entryIndex: id - 1,
    height: 2,
    id,
    stream: logStreams[id % logStreams.length] ?? "stdout",
    text: `row ${id}`,
    top: id * 3,
    width: 60,
  };
}

describe("createLogPreviewWindow", () => {
  test("returns the hovered visible row with ten rows of context on each side when available", () => {
    const rows: IVisibleLogRow[] = Array.from({ length: 30 }, (_, index: number): IVisibleLogRow => {
      return createRow(index + 1);
    });

    expect(createLogPreviewWindow(rows, 15).map((row: IVisibleLogRow): number => row.id)).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
  });

  test("clips the preview window at the start of the visible row list", () => {
    const rows: IVisibleLogRow[] = Array.from({ length: 5 }, (_, index: number): IVisibleLogRow => {
      return createRow(index + 1);
    });

    expect(createLogPreviewWindow(rows, 0).map((row: IVisibleLogRow): number => row.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
