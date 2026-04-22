import type { ILogMinimapMark } from "./createLogMinimapMarks";

export function resolveHoveredLogRowIndex(marks: ILogMinimapMark[], mouseOffsetY: number): number | null {
  if (marks.length === 0) {
    return null;
  }

  let closestMarkIndex: number | null = null;
  let closestDistance: number = Number.POSITIVE_INFINITY;

  for (const [markIndex, mark] of marks.entries()) {
    const markCenterY: number = mark.top + mark.height / 2;
    const distance: number = Math.abs(markCenterY - mouseOffsetY);

    if (distance < closestDistance) {
      closestMarkIndex = markIndex;
      closestDistance = distance;
    }
  }

  return closestMarkIndex;
}
