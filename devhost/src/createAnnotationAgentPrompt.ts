import type { IAnnotationSubmitDetail, IAnnotationMarkerPayload } from "./devtools/features/annotationComposer/types";

export function createAnnotationAgentPrompt(annotation: IAnnotationSubmitDetail): string {
  const markerSections: string = annotation.markers
    .map((marker: IAnnotationMarkerPayload): string => {
      const sectionLines: string[] = [
        `## Marker #${marker.markerNumber}`,
        `- Element: ${marker.element}`,
        `- Element path: ${marker.elementPath}`,
        `- Full path: ${marker.fullPath}`,
        `- Accessibility: ${marker.accessibility}`,
        `- CSS classes: ${marker.cssClasses || "(none)"}`,
        `- Nearby text: ${marker.nearbyText || "(none)"}`,
        `- Nearby elements: ${marker.nearbyElements || "(none)"}`,
        `- Selected text: ${marker.selectedText ?? "(none)"}`,
        `- Source location: ${formatAnnotationSourceLocation(marker)}`,
        `- Fixed positioned: ${marker.isFixed ? "yes" : "no"}`,
        `- Bounding box: x=${marker.boundingBox.x}, y=${marker.boundingBox.y}, width=${marker.boundingBox.width}, height=${marker.boundingBox.height}`,
        "- Computed styles:",
        marker.computedStyles,
        "- Computed style object:",
        JSON.stringify(marker.computedStylesObj, null, 2),
      ];

      return sectionLines.join("\n");
    })
    .join("\n\n");

  return [
    "You are responding to a browser annotation captured by devhost.",
    "Use the annotation context below to inspect the local codebase and drive the requested change.",
    "",
    "## Requested change",
    annotation.comment,
    "",
    "## Page context",
    `- Stack: ${annotation.stackName}`,
    `- URL: ${annotation.url}`,
    `- Title: ${annotation.title}`,
    `- Submitted at: ${new Date(annotation.submittedAt).toISOString()}`,
    "",
    "## Annotated markers",
    markerSections,
    "",
    "## Required behavior",
    "- Inspect the local codebase before proposing changes.",
    "- Use the marker references (#1, #2, ...) when reasoning about the requested UI or behavior.",
    "- If the request is ambiguous, ask clarifying questions before making irreversible changes.",
    "- Prefer correct, durable fixes over quick workarounds.",
  ].join("\n");
}

function formatAnnotationSourceLocation(marker: IAnnotationMarkerPayload): string {
  const sourceLocation = marker.sourceLocation;

  if (sourceLocation === undefined) {
    return "(not available)";
  }

  const columnSuffix: string = sourceLocation.columnNumber === undefined ? "" : `:${sourceLocation.columnNumber}`;
  const componentPrefix: string =
    sourceLocation.componentName === undefined ? "" : `${sourceLocation.componentName} @ `;

  return `${componentPrefix}${sourceLocation.fileName}:${sourceLocation.lineNumber}${columnSuffix}`;
}
