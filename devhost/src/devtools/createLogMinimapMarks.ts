import { createVisibleLogRows, type IVisibleLogRow } from "./createVisibleLogRows";
import type { ServiceLogEntry, ServiceLogStream } from "./types";

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
  return createLogMinimapMarksFromVisibleRows(createVisibleLogRows(entries, viewportHeight, viewportWidth));
}

export function createLogMinimapMarksFromVisibleRows(rows: IVisibleLogRow[]): ILogMinimapMark[] {
  return rows.map((row: IVisibleLogRow): ILogMinimapMark => {
    return {
      entryIndex: row.entryIndex,
      height: row.height,
      id: row.id,
      stream: row.stream,
      top: row.top,
      width: row.width,
    };
  });
}
