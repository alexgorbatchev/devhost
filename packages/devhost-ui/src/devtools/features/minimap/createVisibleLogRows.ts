import type { ServiceLogEntry, ServiceLogStream } from "../../shared/types";
import { parseAnsiLogLine, type ILogAnsiFragment } from "./parseAnsiLogLine";

const markGapInPixels: number = 1;
const markHeightInPixels: number = 2;
const minimumMarkWidthInPixels: number = 2;
const maximumVisibleCharactersPerMarkWidth: number = 80;

// Marks leave this gap from both strip edges; the canvas draws each mark starting at this x offset.
export const LOG_MINIMAP_MARK_INSET_IN_PIXELS: number = 1;

export interface IVisibleLogRow {
  entryIndex: number;
  fragments: ILogAnsiFragment[];
  height: number;
  id: number;
  serviceName: string;
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
      serviceName: entry.serviceName,
      stream: entry.stream,
      text: parsedLine.text,
      top: nextTop,
      width: resolveMarkWidth(entry.stream, parsedLine.text, resolvedViewportWidth),
    });
    nextTop -= strideInPixels;
  }

  return rowsFromBottom.reverse();
}

// stderr marks span the full inset width so error bursts read as solid bands; stdout marks scale with line length.
function resolveMarkWidth(stream: ServiceLogStream, visibleLineText: string, viewportWidth: number): number {
  const insetWidth: number = Math.max(1, viewportWidth - LOG_MINIMAP_MARK_INSET_IN_PIXELS * 2);

  if (stream === "stderr") {
    return insetWidth;
  }

  const normalizedLength: number = Math.min(visibleLineText.length, maximumVisibleCharactersPerMarkWidth);
  const scaledWidth: number = Math.round((normalizedLength / maximumVisibleCharactersPerMarkWidth) * insetWidth);

  return Math.min(insetWidth, Math.max(minimumMarkWidthInPixels, scaledWidth));
}
