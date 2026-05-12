import { defaultAnnotationActionId, type IAnnotationAction } from "../../shared";

import type { IAnnotationSelectionCandidate } from "./annotationSelectionPluginTypes";
import type { IRectSnapshot } from "./types";

export interface ISelectionHighlightFrame {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface ISelectionHighlightCorner {
  x: number;
  y: number;
}

export interface ISelectionOverlayRenderModel extends ISelectionHighlightFrame {
  isVisible: boolean;
  markerLeft: number;
  markerNumber: number;
  markerTop: number;
}

export interface ISelectedAnnotationTarget {
  candidate: IAnnotationSelectionCandidate;
  markerNumber: number;
}

export const markerSize: number = 24;
export const popupWidth: number = 320;
export const selectionCursorStyleId: string = "devhost-annotation-cursor-style";
export const selectionHighlightHorizontalPadding: number = 2;
export const selectionHighlightVerticalPadding: number = 1;

export function readSelectionHighlightFrame(elementRectangle: IRectSnapshot): ISelectionHighlightFrame {
  return {
    height: elementRectangle.height + selectionHighlightVerticalPadding * 2,
    left: elementRectangle.x - selectionHighlightHorizontalPadding,
    top: elementRectangle.y - selectionHighlightVerticalPadding,
    width: elementRectangle.width + selectionHighlightHorizontalPadding * 2,
  };
}

export function readVisibleSelectionHighlightCorner(
  selectionHighlightFrame: ISelectionHighlightFrame,
  viewportHeight: number,
  viewportWidth: number,
): ISelectionHighlightCorner {
  return {
    x: Math.min(Math.max(selectionHighlightFrame.left, 0), viewportWidth),
    y: Math.min(Math.max(selectionHighlightFrame.top, 0), viewportHeight),
  };
}

export function resolveSelectedAnnotationAction(
  annotationActions: IAnnotationAction[],
  selectedActionId: string,
): IAnnotationAction {
  return (
    annotationActions.find((action: IAnnotationAction): boolean => action.id === selectedActionId) ??
    annotationActions[0] ??
    createFallbackAnnotationAction()
  );
}

export function readPixelValue(value: string): number {
  const parsedValue: number = Number.parseFloat(value);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function createFallbackAnnotationAction(): IAnnotationAction {
  return {
    displayName: "Pi",
    id: defaultAnnotationActionId,
    kind: "agent",
    queueEnabled: true,
  };
}
