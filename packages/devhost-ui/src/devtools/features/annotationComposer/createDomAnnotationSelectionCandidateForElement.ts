import { collectElementSnapshot, identifyElement } from "./collectElementSnapshot";
import type { IAnnotationSelectionCandidate } from "./annotationSelectionPluginTypes";
import type { IAnnotationSourceLocation, IRectSnapshot } from "./types";

interface ICreateDomAnnotationSelectionCandidateForElementOptions {
  element: HTMLElement;
  selectedText?: string;
  sourceLocation?: IAnnotationSourceLocation;
}

export function createDomAnnotationSelectionCandidateForElement({
  element,
  selectedText,
  sourceLocation,
}: ICreateDomAnnotationSelectionCandidateForElementOptions): IAnnotationSelectionCandidate {
  const identifiedElement = identifyElement(element);

  return {
    buildMarkerPayload: async (markerNumber: number) => {
      return collectElementSnapshot({
        element,
        elementName: identifiedElement.name,
        elementPath: identifiedElement.path,
        markerNumber,
        selectedText,
        sourceLocation,
      });
    },
    id: identifiedElement.path,
    label: identifiedElement.name,
    readRect: (): IRectSnapshot | null => {
      const elementRectangle: DOMRect = element.getBoundingClientRect();

      if (elementRectangle.width <= 0 || elementRectangle.height <= 0) {
        return null;
      }

      return {
        height: elementRectangle.height,
        width: elementRectangle.width,
        x: elementRectangle.left,
        y: elementRectangle.top,
      };
    },
  };
}
