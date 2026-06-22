import { defaultAnnotationActionId, type IAnnotationAction } from "../../shared";

import type { IAnnotationSelectionCandidate } from "./annotationSelectionPluginTypes";

export interface ISelectedAnnotationTarget {
  candidate: IAnnotationSelectionCandidate;
  markerNumber: number;
}

export const popupWidth: number = 320;
export const selectionCursorStyleId: string = "devhost-annotation-cursor-style";

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

function createFallbackAnnotationAction(): IAnnotationAction {
  return {
    displayName: "Pi",
    id: defaultAnnotationActionId,
    kind: "agent",
    queueEnabled: true,
  };
}
