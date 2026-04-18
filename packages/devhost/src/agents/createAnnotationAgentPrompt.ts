import { dedentTemplate } from "@alexgorbatchev/dedent-string";

import type { IAnnotationSubmitDetail, IAnnotationMarkerPayload } from "../devtools/features/annotationComposer/types";

export function createAnnotationAgentPrompt(annotation: IAnnotationSubmitDetail): string {
  const markerSections: string = annotation.markers
    .map((marker: IAnnotationMarkerPayload): string => renderMarkerSection(marker))
    .join("\n\n");

  return dedentTemplate(
    `
      You are responding to a browser annotation captured by devhost.
      Use the annotation context below to inspect the local codebase and drive the requested change.

      ## Requested change
      {comment}

      ## Page context
      - Stack: {stackName}
      - URL: {url}
      - Title: {title}
      - Submitted at: {submittedAt}

      ## Annotated markers
      {markerSections}

      ## Required behavior
      - Inspect the local codebase before proposing changes.
      - Use the marker references (#1, #2, ...) when reasoning about the requested UI or behavior.
      - If the request is ambiguous, ask clarifying questions before making irreversible changes.
      - Prefer correct, durable fixes over quick workarounds.
    `,
    {
      comment: annotation.comment,
      markerSections,
      stackName: annotation.stackName,
      submittedAt: new Date(annotation.submittedAt).toISOString(),
      title: annotation.title,
      url: annotation.url,
    },
  );
}

function renderMarkerSection(marker: IAnnotationMarkerPayload): string {
  return dedentTemplate(
    `
      ### Marker #{markerNumber}
      - Full path: {fullPath}
      - Accessibility: {accessibility}
      - Nearby text: {nearbyText}
      - Nearby elements: {nearbyElements}
      - Selected text: {selectedText}
      - Source location: {sourceLocation}
      - Fixed positioned: {isFixed}
      - Bounding box: x={x}, y={y}, width={width}, height={height}
      - Computed styles:
      {computedStyles}
    `,
    {
      accessibility: marker.accessibility || "(none)",
      computedStyles: marker.computedStyles,
      fullPath: marker.fullPath,
      isFixed: marker.isFixed ? "yes" : "no",
      markerNumber: String(marker.markerNumber),
      nearbyElements: marker.nearbyElements || "(none)",
      nearbyText: marker.nearbyText || "(none)",
      selectedText: marker.selectedText ?? "(none)",
      sourceLocation: formatAnnotationSourceLocation(marker),
      width: String(marker.boundingBox.width),
      x: String(marker.boundingBox.x),
      y: String(marker.boundingBox.y),
      height: String(marker.boundingBox.height),
    },
  );
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
