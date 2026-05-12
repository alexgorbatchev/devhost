import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../shared/constants";
import { createDomAnnotationSelectionCandidateForElement } from "./createDomAnnotationSelectionCandidateForElement";
import { getElementSourceLocation } from "./getElementSourceLocation";
import { resolveAnnotationTarget } from "./resolveAnnotationTarget";
import type { IAnnotationSelectionPlugin } from "./annotationSelectionPluginTypes";

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

    return createDomAnnotationSelectionCandidateForElement({
      element: interactionTarget,
      selectedText: intent === "select" ? readSelectedText() : undefined,
      sourceLocation: intent === "select" ? await getElementSourceLocation(interactionTarget) : undefined,
    });
  },
};

function readSelectedText(): string | undefined {
  const selection: Selection | null = window.getSelection();
  const selectedText: string = selection?.toString().trim() ?? "";

  if (selectedText.length === 0) {
    return undefined;
  }

  return selectedText.slice(0, 500);
}

function createSelectionCursorStyleText(): string {
  return `
    body * {
      cursor: default !important;
    }
    a[href],
    button,
    input[type="button"],
    input[type="image"],
    input[type="reset"],
    input[type="submit"],
    label[for],
    select,
    summary,
    [data-devhost-cursor="pointer"],
    [role="button"] {
      cursor: pointer !important;
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
