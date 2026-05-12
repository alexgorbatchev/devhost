import type { JSX } from "react";

import { css, useDevtoolsTheme } from "../../shared";

import { clamp } from "./annotationComposerUtils";
import { markerSize, type IMarkerRenderModel, type ISelectedAnnotationTarget } from "./annotationComposerModels";
import {
  createHoverHighlightStyle,
  createMarkerStyle,
  createSelectionHighlightStyle,
  overlayStyle,
} from "./annotationComposerStyles";
import type { IRectSnapshot } from "./types";

interface IAnnotationSelectionOverlayProps {
  hoveredRectangle?: IRectSnapshot | null;
  isHoveredElementSelected?: boolean;
  isSelectionMode?: boolean;
  selectedTargets: ISelectedAnnotationTarget[];
  testIdPrefix?: string;
  viewportPadding: number;
}

export function AnnotationSelectionOverlay({
  hoveredRectangle = null,
  isHoveredElementSelected = false,
  isSelectionMode = false,
  selectedTargets,
  testIdPrefix = "AnnotationSelectionOverlay",
  viewportPadding,
}: IAnnotationSelectionOverlayProps): JSX.Element {
  const theme = useDevtoolsTheme();
  const markerRenderModels: IMarkerRenderModel[] = selectedTargets.flatMap(
    (selection: ISelectedAnnotationTarget): IMarkerRenderModel[] => {
      const elementRectangle: IRectSnapshot | null = selection.candidate.readRect();

      if (elementRectangle === null) {
        return [];
      }

      const markerTop: number = clamp(
        elementRectangle.y - markerSize / 2,
        viewportPadding,
        window.innerHeight - markerSize - viewportPadding,
      );
      const markerLeft: number = clamp(
        elementRectangle.x - markerSize / 2,
        viewportPadding,
        window.innerWidth - markerSize - viewportPadding,
      );
      const isVisible: boolean =
        elementRectangle.width > 0 &&
        elementRectangle.height > 0 &&
        elementRectangle.y + elementRectangle.height >= 0 &&
        elementRectangle.x + elementRectangle.width >= 0 &&
        elementRectangle.y <= window.innerHeight &&
        elementRectangle.x <= window.innerWidth;

      return [
        {
          elementHeight: elementRectangle.height,
          elementLeft: elementRectangle.x,
          elementTop: elementRectangle.y,
          elementWidth: elementRectangle.width,
          isVisible,
          markerLeft,
          markerNumber: selection.markerNumber,
          markerTop,
        },
      ];
    },
  );

  return (
    <div data-testid="AnnotationSelectionOverlay" className={css(overlayStyle)}>
      {isSelectionMode && hoveredRectangle !== null && !isHoveredElementSelected ? (
        <div
          className={css(createHoverHighlightStyle(theme, hoveredRectangle))}
          data-testid={`${testIdPrefix}--hover-highlight`}
        />
      ) : null}
      {markerRenderModels.map((marker: IMarkerRenderModel) => {
        if (!marker.isVisible) {
          return null;
        }

        return (
          <div key={marker.markerNumber}>
            <div
              className={css(createSelectionHighlightStyle(theme, marker))}
              data-testid={`${testIdPrefix}--selection-highlight`}
            />
            <div className={css(createMarkerStyle(theme, marker))} data-testid={`${testIdPrefix}--marker`}>
              {marker.markerNumber}
            </div>
          </div>
        );
      })}
    </div>
  );
}
