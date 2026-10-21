import type { IAnnotationSelectionCandidate } from "./annotationSelectionPluginTypes";

export interface ISelectedAnnotationTarget {
  candidate: IAnnotationSelectionCandidate;
  markerNumber: number;
}

export const selectionCursorStyleId: string = "devhost-annotation-cursor-style";
