import type { ILogMinimapMark } from "./createLogMinimapMarks";
import { createLogPreviewRange, type ILogPreviewRange } from "./createLogPreviewRange";

const minimumVisibleRows: number = 1;
const preferredMaximumVisibleRows: number = 21;

export interface ILogPreviewLayout {
  range: ILogPreviewRange;
  top: number;
}

export interface IResolveLogPreviewLayoutOptions {
  borderWidth: number;
  hoveredRowIndex: number;
  marks: ILogMinimapMark[];
  previewPadding: number;
  rowGap: number;
  rowHeight: number;
  viewportHeight: number;
  viewportPadding: number;
}

export function resolveLogPreviewLayout(options: IResolveLogPreviewLayoutOptions): ILogPreviewLayout | null {
  if (options.marks.length === 0 || options.hoveredRowIndex < 0 || options.hoveredRowIndex >= options.marks.length) {
    return null;
  }

  const resolvedRowHeight: number = Math.max(1, Math.floor(options.rowHeight));
  const resolvedRowGap: number = Math.max(0, Math.floor(options.rowGap));
  const resolvedPreviewPadding: number = Math.max(0, Math.floor(options.previewPadding));
  const resolvedViewportPadding: number = Math.max(0, Math.floor(options.viewportPadding));
  const resolvedBorderWidth: number = Math.max(0, Math.floor(options.borderWidth));
  const resolvedViewportHeight: number = Math.max(0, Math.floor(options.viewportHeight));
  const previewChromeHeight: number = resolvedBorderWidth * 2 + resolvedPreviewPadding * 2;
  const availableListHeight: number = Math.max(0, resolvedViewportHeight - resolvedViewportPadding * 2 - previewChromeHeight);
  const rowStride: number = resolvedRowHeight + resolvedRowGap;
  const rawVisibleRows: number = Math.max(
    minimumVisibleRows,
    Math.floor((availableListHeight + resolvedRowGap) / Math.max(1, rowStride)),
  );
  const viewportMaximumVisibleRows: number = rawVisibleRows > 1 && rawVisibleRows % 2 === 0 ? rawVisibleRows - 1 : rawVisibleRows;
  const maximumVisibleRows: number = Math.min(preferredMaximumVisibleRows, viewportMaximumVisibleRows);
  const range: ILogPreviewRange | null = createLogPreviewRange(
    options.marks.length,
    options.hoveredRowIndex,
    maximumVisibleRows,
  );

  if (range === null) {
    return null;
  }

  const visibleRowCount: number = range.endIndex - range.startIndex;
  const listHeight: number = visibleRowCount * resolvedRowHeight + Math.max(0, visibleRowCount - 1) * resolvedRowGap;
  const previewHeight: number = listHeight + previewChromeHeight;
  const hoveredMark: ILogMinimapMark = options.marks[options.hoveredRowIndex];
  const hoveredMarkCenter: number = hoveredMark.top + hoveredMark.height / 2;
  const hoveredRowOffset: number = (options.hoveredRowIndex - range.startIndex) * rowStride;
  const desiredTop: number =
    hoveredMarkCenter - (resolvedBorderWidth + resolvedPreviewPadding + hoveredRowOffset + resolvedRowHeight / 2);
  const minimumTop: number = resolvedViewportPadding;
  const maximumTop: number = Math.max(resolvedViewportPadding, resolvedViewportHeight - resolvedViewportPadding - previewHeight);
  const top: number = Math.min(maximumTop, Math.max(minimumTop, desiredTop));

  return {
    range,
    top,
  };
}
