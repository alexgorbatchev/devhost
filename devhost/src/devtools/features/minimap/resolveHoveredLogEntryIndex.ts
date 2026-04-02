import type { ILogMinimapMark } from "./createLogMinimapMarks";
import { resolveHoveredLogRowIndex } from "./resolveHoveredLogRowIndex";

export function resolveHoveredLogEntryIndex(marks: ILogMinimapMark[], mouseOffsetY: number): number | null {
  return resolveHoveredLogRowIndex(marks, mouseOffsetY);
}
