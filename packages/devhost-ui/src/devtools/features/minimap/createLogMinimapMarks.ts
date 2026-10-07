import type { IVisibleLogRow } from "./createVisibleLogRows";
import type { ServiceLogStream } from "../../shared/types";

export interface ILogMinimapMark {
  entryIndex: number;
  height: number;
  id: number;
  stream: ServiceLogStream;
  top: number;
  width: number;
}

export function createLogMinimapMarks(rows: IVisibleLogRow[]): ILogMinimapMark[] {
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
