import type { ServiceLogEntry, ServiceLogStream } from "./types";

const maximumCharactersPerWrappedRow: number = 80;
const markGapInPixels: number = 1;
const markHeightInPixels: number = 2;
const minimumWidthRatio: number = 0.12;

export interface ILogMinimapMark {
  entryIndex: number;
  height: number;
  id: number;
  stream: ServiceLogStream;
  top: number;
  width: number;
}

export function createLogMinimapMarks(
  entries: ServiceLogEntry[],
  viewportHeight: number,
  viewportWidth: number,
): ILogMinimapMark[] {
  const resolvedViewportHeight: number = Math.max(0, Math.floor(viewportHeight));
  const resolvedViewportWidth: number = Math.max(0, Math.floor(viewportWidth));

  if (entries.length === 0 || resolvedViewportHeight === 0 || resolvedViewportWidth === 0) {
    return [];
  }

  const strideInPixels: number = markHeightInPixels + markGapInPixels;
  const marksFromBottom: ILogMinimapMark[] = [];
  let nextTop: number = resolvedViewportHeight - markHeightInPixels;

  for (let entryIndex = entries.length - 1; entryIndex >= 0 && nextTop + markHeightInPixels > 0; entryIndex -= 1) {
    const entry: ServiceLogEntry = entries[entryIndex];
    const wrappedRowLengths: number[] = createWrappedRowLengths(entry.line);

    for (
      let wrappedRowIndex = wrappedRowLengths.length - 1;
      wrappedRowIndex >= 0 && nextTop + markHeightInPixels > 0;
      wrappedRowIndex -= 1
    ) {
      const wrappedRowLength: number = wrappedRowLengths[wrappedRowIndex];

      marksFromBottom.push({
        entryIndex,
        height: markHeightInPixels,
        id: entry.id,
        stream: entry.stream,
        top: nextTop,
        width: resolveMarkWidth(wrappedRowLength, resolvedViewportWidth),
      });
      nextTop -= strideInPixels;
    }
  }

  return marksFromBottom.reverse();
}

function createWrappedRowLengths(line: string): number[] {
  const lineLength: number = Math.max(0, line.length);

  if (lineLength === 0) {
    return [0];
  }

  const wrappedRowLengths: number[] = [];
  let remainingLength: number = lineLength;

  while (remainingLength > 0) {
    const wrappedRowLength: number = Math.min(maximumCharactersPerWrappedRow, remainingLength);

    wrappedRowLengths.push(wrappedRowLength);
    remainingLength -= wrappedRowLength;
  }

  return wrappedRowLengths;
}

function resolveMarkWidth(wrappedRowLength: number, viewportWidth: number): number {
  const minimumWidth: number = Math.max(1, Math.round(viewportWidth * minimumWidthRatio));
  const normalizedLength: number = Math.min(wrappedRowLength, maximumCharactersPerWrappedRow);
  const scaledWidth: number = Math.round((normalizedLength / maximumCharactersPerWrappedRow) * viewportWidth);

  return Math.max(minimumWidth, scaledWidth);
}
