import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../shared/constants";
import { collectElementSnapshot, identifyElement } from "./collectElementSnapshot";
import { getElementSourceLocation } from "./getElementSourceLocation";
import { resolveAnnotationTarget } from "./resolveAnnotationTarget";
import type { IAnnotationSelectionCandidate, IAnnotationSelectionPlugin } from "./annotationSelectionPluginTypes";
import type { IAnnotationSourceLocation, IRectSnapshot } from "./types";

interface IDomAnnotationSelectionCandidateOptions {
  element: HTMLElement;
  label: string;
  path: string;
  selectedText?: string;
  sourceLocation?: IAnnotationSourceLocation;
}

export const defaultDomAnnotationSelectionPlugin: IAnnotationSelectionPlugin = {
  getCursorStyleText: createSelectionCursorStyleText,
  id: "dom-elements",
  label: "DOM elements",
  priority: 0,
  resolveCandidate: async (event, intent, context) => {
    if (context.isDevtoolsEventTarget(event.target)) {
      return null;
    }

    const interactionTarget: HTMLElement | null = resolveAnnotationTarget(event.clientX, event.clientY);

    if (interactionTarget === null) {
      return null;
    }

    const identifiedElement = identifyElement(interactionTarget);

    return createDomAnnotationSelectionCandidate({
      element: interactionTarget,
      label: identifiedElement.name,
      path: identifiedElement.path,
      selectedText: intent === "select" ? readSelectedText() : undefined,
      sourceLocation: intent === "select" ? await getElementSourceLocation(interactionTarget) : undefined,
    });
  },
};

function createDomAnnotationSelectionCandidate(
  options: IDomAnnotationSelectionCandidateOptions,
): IAnnotationSelectionCandidate {
  return {
    buildMarkerPayload: async (markerNumber: number) => {
      return collectElementSnapshot({
        element: options.element,
        elementName: options.label,
        elementPath: options.path,
        markerNumber,
        selectedText: options.selectedText,
        sourceLocation: options.sourceLocation,
      });
    },
    id: options.path,
    label: options.label,
    readRect: (): IRectSnapshot | null => {
      const elementRectangle: DOMRect = options.element.getBoundingClientRect();

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

function readSelectedText(): string | undefined {
  const selection: Selection | null = window.getSelection();
  const selectedText: string = selection?.toString().trim() ?? "";

  if (selectedText.length === 0) {
    return undefined;
  }

  return selectedText.slice(0, 500);
}

function createSelectionCursorStyleText(): string {
  // Intentionally document-scoped: selection mode targets host-page elements outside the devtools shadow root,
  // so the cursor affordance must temporarily apply beyond the injected UI boundary.
  return `
    body * {
      cursor: crosshair !important;
    }
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}], [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] * {
      cursor: default !important;
    }
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] button,
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] button *,
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] [role="button"],
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] [role="button"] * {
      cursor: pointer !important;
    }
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] textarea,
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] input[type="text"] {
      cursor: text !important;
    }
  `;
}
