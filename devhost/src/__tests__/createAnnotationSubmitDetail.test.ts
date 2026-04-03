import { describe, expect, test } from "bun:test";

import { createAnnotationSubmitDetail } from "../devtools/features/annotationComposer/createAnnotationSubmitDetail";
import type { IAnnotationMarkerPayload } from "../devtools/features/annotationComposer/types";

describe("createAnnotationSubmitDetail", () => {
  test("captures the provided page context alongside the submitted markers", () => {
    const markers: IAnnotationMarkerPayload[] = [
      {
        accessibility: 'role="button", focusable',
        boundingBox: {
          height: 24,
          width: 80,
          x: 16,
          y: 32,
        },
        computedStyles: "color: rgb(0, 0, 0)",
        computedStylesObj: {
          color: "rgb(0, 0, 0)",
        },
        cssClasses: "cta-button",
        element: 'button "Save"',
        elementPath: ".toolbar > button",
        fullPath: "body > div.toolbar > button",
        isFixed: false,
        markerNumber: 1,
        nearbyElements: 'a "Docs"',
        nearbyText: "Save your work",
        sourceLocation: {
          columnNumber: 8,
          componentName: "SaveButton",
          fileName: "src/components/SaveButton.tsx",
          lineNumber: 42,
        },
      },
    ];
    const detail = createAnnotationSubmitDetail({
      comment: "Update #1 to use the new label.",
      markers,
      stackName: "example-stack",
      submittedAt: 1_717_000_000_000,
      title: "Example page",
      url: "https://example.test/products",
    });

    expect(detail).toEqual({
      comment: "Update #1 to use the new label.",
      markers,
      stackName: "example-stack",
      submittedAt: 1_717_000_000_000,
      title: "Example page",
      url: "https://example.test/products",
    });
  });
});
