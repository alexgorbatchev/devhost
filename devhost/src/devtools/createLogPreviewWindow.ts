import type { IVisibleLogRow } from "./createVisibleLogRows";
import { createLogPreviewRange } from "./createLogPreviewRange";

export function createLogPreviewWindow(
  rows: IVisibleLogRow[],
  rowIndex: number,
  maximumVisibleRows?: number,
): IVisibleLogRow[] {
  const previewRange = createLogPreviewRange(rows.length, rowIndex, maximumVisibleRows);

  if (previewRange === null) {
    return [];
  }

  return rows.slice(previewRange.startIndex, previewRange.endIndex);
}
