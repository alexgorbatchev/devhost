import type { ServiceLogEntry, ServiceLogStream } from "../../shared/types";

const maximumCharactersPerWrappedRow: number = 80;
const markGapInPixels: number = 1;
const markHeightInPixels: number = 2;
const minimumWidthRatio: number = 0.12;

export interface IVisibleLogRow {
  entryIndex: number;
  height: number;
  id: number;
  stream: ServiceLogStream;
  text: string;
  top: number;
  width: number;
}

export function createVisibleLogRows(
  entries: ServiceLogEntry[],
  viewportHeight: number,
  viewportWidth: number,
): IVisibleLogRow[] {
  const resolvedViewportHeight: number = Math.max(0, Math.floor(viewportHeight));
  const resolvedViewportWidth: number = Math.max(0, Math.floor(viewportWidth));

  if (entries.length === 0 || resolvedViewportHeight === 0 || resolvedViewportWidth === 0) {
    return [];
  }

  const strideInPixels: number = markHeightInPixels + markGapInPixels;
  const rowsFromBottom: IVisibleLogRow[] = [];
  let nextTop: number = resolvedViewportHeight - markHeightInPixels;

  for (let entryIndex = entries.length - 1; entryIndex >= 0 && nextTop + markHeightInPixels > 0; entryIndex -= 1) {
    const entry: ServiceLogEntry = entries[entryIndex]!;
    const wrappedRows: string[] = createWrappedRows(entry.line);

    for (
      let wrappedRowIndex = wrappedRows.length - 1;
      wrappedRowIndex >= 0 && nextTop + markHeightInPixels > 0;
      wrappedRowIndex -= 1
    ) {
      const wrappedRowText: string = wrappedRows[wrappedRowIndex]!;

      rowsFromBottom.push({
        entryIndex,
        height: markHeightInPixels,
        id: entry.id,
        stream: entry.stream,
        text: wrappedRowText,
        top: nextTop,
        width: resolveMarkWidth(wrappedRowText, resolvedViewportWidth),
      });
      nextTop -= strideInPixels;
    }
  }

  return rowsFromBottom.reverse();
}

function createWrappedRows(line: string): string[] {
  if (line.length === 0) {
    return [""];
  }

  const wrappedRows: string[] = [];
  let startIndex: number = 0;

  while (startIndex < line.length) {
    wrappedRows.push(line.slice(startIndex, startIndex + maximumCharactersPerWrappedRow));
    startIndex += maximumCharactersPerWrappedRow;
  }

  return wrappedRows;
}

function resolveMarkWidth(wrappedRowText: string, viewportWidth: number): number {
  const minimumWidth: number = Math.max(1, Math.round(viewportWidth * minimumWidthRatio));
  const normalizedLength: number = Math.min(wrappedRowText.length, maximumCharactersPerWrappedRow);
  const scaledWidth: number = Math.round((normalizedLength / maximumCharactersPerWrappedRow) * viewportWidth);

  return Math.max(minimumWidth, scaledWidth);
}
