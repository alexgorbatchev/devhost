import type { ServiceLogEntry, ServiceLogStream } from "../../shared/types";
import { parseAnsiLogLine, type ILogAnsiFragment } from "./parseAnsiLogLine";

const markGapInPixels: number = 1;
const markHeightInPixels: number = 2;
const minimumWidthRatio: number = 0.12;

export interface IVisibleLogRow {
  entryIndex: number;
  fragments: ILogAnsiFragment[];
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
    const parsedLine = parseAnsiLogLine(entry.line);

    rowsFromBottom.push({
      entryIndex,
      fragments: parsedLine.fragments,
      height: markHeightInPixels,
      id: entry.id,
      stream: entry.stream,
      text: parsedLine.text,
      top: nextTop,
      width: resolveMarkWidth(parsedLine.text, resolvedViewportWidth),
    });
    nextTop -= strideInPixels;
  }

  return rowsFromBottom.reverse();
}

function resolveMarkWidth(visibleLineText: string, viewportWidth: number): number {
  const minimumWidth: number = Math.max(1, Math.round(viewportWidth * minimumWidthRatio));
  const maximumVisibleCharactersPerPreviewLine: number = 80;
  const normalizedLength: number = Math.min(visibleLineText.length, maximumVisibleCharactersPerPreviewLine);
  const scaledWidth: number = Math.round((normalizedLength / maximumVisibleCharactersPerPreviewLine) * viewportWidth);

  return Math.max(minimumWidth, scaledWidth);
}
