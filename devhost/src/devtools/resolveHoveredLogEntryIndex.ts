import type { ILogMinimapMark } from "./createLogMinimapMarks";

export function resolveHoveredLogEntryIndex(marks: ILogMinimapMark[], mouseOffsetY: number): number | null {
  if (marks.length === 0) {
    return null;
  }

  let closestMark: ILogMinimapMark | null = null;
  let closestDistance: number = Number.POSITIVE_INFINITY;

  for (const mark of marks) {
    const markCenterY: number = mark.top + mark.height / 2;
    const distance: number = Math.abs(markCenterY - mouseOffsetY);

    if (distance < closestDistance) {
      closestMark = mark;
      closestDistance = distance;
    }
  }

  return closestMark?.entryIndex ?? null;
}
