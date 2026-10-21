import type { AnnotationShapeKind, IAnnotationPoint, IAnnotationShape } from "./types";

const minimumShapeSize: number = 4;

export function createAnnotationShape(
  id: string,
  kind: AnnotationShapeKind,
  start: IAnnotationPoint,
  end: IAnnotationPoint,
): IAnnotationShape | null {
  const width: number = Math.abs(end.x - start.x);
  const height: number = Math.abs(end.y - start.y);
  if (kind === "box") {
    if (width < minimumShapeSize || height < minimumShapeSize) {
      return null;
    }
    return {
      id,
      kind,
      start: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
      end: { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
    };
  }
  if (Math.hypot(width, height) < minimumShapeSize) {
    return null;
  }
  return { id, kind, start, end };
}
