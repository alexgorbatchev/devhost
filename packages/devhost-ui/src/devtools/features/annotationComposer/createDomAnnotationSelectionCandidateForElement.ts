import { collectElementSnapshot, identifyElement } from "./collectElementSnapshot";
import type { IAnnotationSelectionCandidate } from "./annotationSelectionPluginTypes";
import type { IAnnotationSourceLocation, IRectSnapshot } from "./types";

interface ICreateDomAnnotationSelectionCandidateForElementOptions {
  element: HTMLElement;
  selectedText?: string;
  sourceLocation?: IAnnotationSourceLocation;
}

const elementIdentities: WeakMap<HTMLElement, string> = new WeakMap<HTMLElement, string>();
let nextElementIdentity: number = 1;

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
    id: readElementIdentity(element),
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

// An element path reads well in an annotation but does not tell apart siblings that share a tag and class, so a
// candidate is identified by the element itself.
function readElementIdentity(element: HTMLElement): string {
  const knownIdentity: string | undefined = elementIdentities.get(element);

  if (knownIdentity !== undefined) {
    return knownIdentity;
  }

  const identity: string = `dom-element-${nextElementIdentity}`;

  nextElementIdentity += 1;
  elementIdentities.set(element, identity);

  return identity;
}
