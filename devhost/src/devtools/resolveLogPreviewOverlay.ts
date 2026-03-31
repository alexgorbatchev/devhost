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

  const overlayMarks: ILogMinimapMark[] = marks.filter((mark: ILogMinimapMark): boolean => {
    return mark.entryIndex >= previewRange.startIndex && mark.entryIndex < previewRange.endIndex;
  });

  if (overlayMarks.length === 0) {
    return null;
  }

  const top: number = overlayMarks[0].top;
  const lastMark: ILogMinimapMark = overlayMarks[overlayMarks.length - 1];
  const height: number = lastMark.top + lastMark.height - top;

  return {
    height,
    top,
  };
}
