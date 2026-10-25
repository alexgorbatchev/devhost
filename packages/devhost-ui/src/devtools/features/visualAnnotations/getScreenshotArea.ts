import type { IAnnotationPoint, IScreenshotArea, ITabSnapshot } from "./types";
type ScreenshotSize = Pick<ITabSnapshot, "width" | "height">;

export function getScreenshotArea(
  start: IAnnotationPoint,
  end: IAnnotationPoint,
  snapshot: ScreenshotSize,
): IScreenshotArea | null {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
  if (start.x === end.x || start.y === end.y) return null;
  const x = Math.max(0, Math.floor(Math.min(snapshot.width, start.x, end.x)));
  const y = Math.max(0, Math.floor(Math.min(snapshot.height, start.y, end.y)));
  const right = Math.min(snapshot.width, Math.ceil(Math.max(0, start.x, end.x)));
  const bottom = Math.min(snapshot.height, Math.ceil(Math.max(0, start.y, end.y)));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}
