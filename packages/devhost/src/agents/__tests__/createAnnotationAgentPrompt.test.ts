import { describe, expect, test } from "bun:test";

import { createAnnotationAgentPrompt } from "../createAnnotationAgentPrompt";

describe("createAnnotationAgentPrompt", () => {
  test("renders the annotation detail into a structured agent prompt", () => {
    const prompt: string = createAnnotationAgentPrompt({
      comment: "Replace #1 with the new primary CTA and keep #2 aligned.",
      markers: [
        {
          accessibility: 'role="button", focusable',
          boundingBox: {
            height: 24,
            width: 120,
            x: 16,
            y: 40,
          },
          computedStyles: "color: rgb(17, 24, 39)",
          computedStylesObj: {
            color: "rgb(17, 24, 39)",
          },
          cssClasses: "cta-button",
          element: 'button "Save changes"',
          elementPath: ".toolbar > button",
          fullPath: "body > div.toolbar > button",
          isFixed: false,
          markerNumber: 1,
          nearbyElements: 'a "Docs"',
          nearbyText: "Save your work",
          selectedText: "Save changes",
          sourceLocation: {
            columnNumber: 8,
            componentName: "SaveButton",
            fileName: "src/components/SaveButton.tsx",
            lineNumber: 42,
          },
        },
      ],
      stackName: "hello-stack",
      submittedAt: Date.UTC(2026, 2, 30, 18, 45, 0),
      title: "Example page",
      url: "https://example.test/products",
    });

    expect(prompt).toMatchInlineSnapshot(`
      "You are responding to a browser annotation captured by devhost.
      Use the annotation context below to inspect the local codebase and drive the requested change.
      
      ## Requested change
      Replace #1 with the new primary CTA and keep #2 aligned.
      
      ## Page context
      - Stack: hello-stack
      - URL: https://example.test/products
      - Title: Example page
      - Submitted at: 2026-03-30T18:45:00.000Z
      
      ## Annotated markers
      ### Marker #1
      - Full path: body > div.toolbar > button
      - Accessibility: role="button", focusable
      - Nearby text: Save your work
      - Nearby elements: a "Docs"
      - Selected text: Save changes
      - Source location: SaveButton @ src/components/SaveButton.tsx:42:8
      - Fixed positioned: no
      - Bounding box: x=16, y=40, width=120, height=24
      - Computed styles:
      color: rgb(17, 24, 39)
      
      ## Required behavior
      - Inspect the local codebase before proposing changes.
      - Use the marker references (#1, #2, ...) when reasoning about the requested UI or behavior.
      - If the request is ambiguous, ask clarifying questions before making irreversible changes.
      - Prefer correct, durable fixes over quick workarounds."
    `);
  });
});
