import type { JSX } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { css, DEVTOOLS_ROOT_ID, useDevtoolsTheme } from "../../shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../shared/constants";

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
  const portalAnchorReference = useRef<HTMLSpanElement | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const anchorElement: HTMLSpanElement | null = portalAnchorReference.current;

    if (anchorElement === null) {
      return;
    }

    setPortalTarget(resolveOverlayPortalTarget(anchorElement));
  }, []);

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

  const overlay = (
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

  return (
    <>
      <span ref={portalAnchorReference} hidden />
      {portalTarget === null ? null : createPortal(overlay, portalTarget)}
    </>
  );
}

function resolveOverlayPortalTarget(anchorElement: HTMLElement): HTMLElement {
  const rootNode: Node = anchorElement.getRootNode();

  if (rootNode instanceof ShadowRoot) {
    const shadowAppRoot: HTMLElement | null = rootNode.querySelector<HTMLElement>(`#${DEVTOOLS_ROOT_ID}`);

    if (shadowAppRoot !== null) {
      return shadowAppRoot;
    }

    const shadowRootFallback: HTMLElement | null = rootNode.querySelector<HTMLElement>(
      `[${DEVTOOLS_ROOT_ATTRIBUTE_NAME}]`,
    );

    if (shadowRootFallback !== null) {
      return shadowRootFallback;
    }
  }

  const documentAppRoot: HTMLElement | null = anchorElement.ownerDocument.getElementById(DEVTOOLS_ROOT_ID);

  if (documentAppRoot !== null) {
    return documentAppRoot;
  }

  const documentBody: HTMLElement | null = anchorElement.ownerDocument.body;

  if (documentBody !== null) {
    return documentBody;
  }

  return anchorElement;
}
