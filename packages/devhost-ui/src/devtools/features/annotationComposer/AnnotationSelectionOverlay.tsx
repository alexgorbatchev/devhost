import type { JSX } from "react";

import { HighlightOverlay, type IHighlightOverlayItem } from "../../shared";

import type { ISelectedAnnotationTarget } from "./annotationComposerModels";
import type { IRectSnapshot } from "./types";

interface IAnnotationSelectionOverlayProps {
  hoveredRectangle?: IRectSnapshot | null;
  isHoveredElementSelected?: boolean;
  isSelectionMode?: boolean;
  selectedTargets: ISelectedAnnotationTarget[];
  testIdPrefix?: string;
}

export function AnnotationSelectionOverlay({
  hoveredRectangle = null,
  isHoveredElementSelected = false,
  isSelectionMode = false,
  selectedTargets,
  testIdPrefix = "AnnotationSelectionOverlay",
}: IAnnotationSelectionOverlayProps): JSX.Element {
  const hoverHighlights: IHighlightOverlayItem[] =
    isSelectionMode && hoveredRectangle !== null && !isHoveredElementSelected
      ? [{ id: "hover", readRectangle: () => hoveredRectangle }]
      : [];
  const selectedHighlights: IHighlightOverlayItem[] = selectedTargets.map(
    (selectedTarget: ISelectedAnnotationTarget): IHighlightOverlayItem => {
      return {
        badge: selectedTarget.markerNumber,
        id: selectedTarget.markerNumber,
        readRectangle: selectedTarget.candidate.readRect,
      };
    },
  );

  return (
    <>
      {hoverHighlights.length > 0 ? (
        <HighlightOverlay
          highlights={hoverHighlights}
          highlightTestId={`${testIdPrefix}--hover-highlight`}
          rootTestId={undefined}
        />
      ) : null}
      {selectedHighlights.length > 0 ? (
        <HighlightOverlay
          badgeTestId={`${testIdPrefix}--marker`}
          highlightTestId={`${testIdPrefix}--selection-highlight`}
          highlights={selectedHighlights}
          rootTestId="AnnotationSelectionOverlay"
        />
      ) : null}
    </>
  );
}
