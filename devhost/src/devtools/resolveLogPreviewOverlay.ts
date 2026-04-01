import type { ILogMinimapMark } from "./createLogMinimapMarks";
import type { ILogPreviewRange } from "./createLogPreviewRange";

export interface ILogPreviewOverlay {
  height: number;
  top: number;
}

export function resolveLogPreviewOverlay(
  marks: ILogMinimapMark[],
  previewRange: ILogPreviewRange | null,
): ILogPreviewOverlay | null {
  if (previewRange === null || marks.length === 0) {
    return null;
  }

  const startIndex: number = Math.max(0, previewRange.startIndex);
  const endIndex: number = Math.min(marks.length, previewRange.endIndex);

  if (startIndex >= endIndex) {
    return null;
  }

  const overlayMarks: ILogMinimapMark[] = marks.slice(startIndex, endIndex);
  const top: number = overlayMarks[0].top;
  const lastMark: ILogMinimapMark = overlayMarks[overlayMarks.length - 1];
  const height: number = lastMark.top + lastMark.height - top;

  return {
    height,
    top,
  };
}
