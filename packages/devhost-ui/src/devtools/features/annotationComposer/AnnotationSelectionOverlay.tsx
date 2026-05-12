import type { JSX } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { css, DEVTOOLS_ROOT_ID, useDevtoolsTheme } from "../../shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../shared/constants";

import { clamp } from "./annotationComposerUtils";
import {
  markerSize,
  readSelectionHighlightFrame,
  readVisibleSelectionHighlightCorner,
  type ISelectedAnnotationTarget,
  type ISelectionOverlayRenderModel,
} from "./annotationComposerModels";
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
  const scheduledFrameReference = useRef<number | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [, setLayoutVersion] = useState<number>(0);

  useLayoutEffect(() => {
    const anchorElement: HTMLSpanElement | null = portalAnchorReference.current;

    if (anchorElement === null) {
      return;
    }

    setPortalTarget(resolveOverlayPortalTarget(anchorElement));
  }, []);

  useLayoutEffect(() => {
    if (selectedTargets.length === 0) {
      return;
    }

    const anchorElement: HTMLSpanElement | null = portalAnchorReference.current;

    if (anchorElement === null) {
      return;
    }

    const ownerWindow: Window | null = anchorElement.ownerDocument.defaultView;

    if (ownerWindow === null) {
      return;
    }

    const scheduleLayoutRefresh = (): void => {
      if (scheduledFrameReference.current !== null) {
        return;
      }

      scheduledFrameReference.current = ownerWindow.requestAnimationFrame((): void => {
        scheduledFrameReference.current = null;
        setLayoutVersion((currentVersion: number): number => currentVersion + 1);
      });
    };

    ownerWindow.addEventListener("resize", scheduleLayoutRefresh);
    ownerWindow.addEventListener("scroll", scheduleLayoutRefresh, true);

    return () => {
      ownerWindow.removeEventListener("resize", scheduleLayoutRefresh);
      ownerWindow.removeEventListener("scroll", scheduleLayoutRefresh, true);

      if (scheduledFrameReference.current !== null) {
        ownerWindow.cancelAnimationFrame(scheduledFrameReference.current);
        scheduledFrameReference.current = null;
      }
    };
  }, [selectedTargets.length]);

  const markerRenderModels: ISelectionOverlayRenderModel[] = selectedTargets.flatMap(
    (selection: ISelectedAnnotationTarget): ISelectionOverlayRenderModel[] => {
      const elementRectangle: IRectSnapshot | null = selection.candidate.readRect();

      if (elementRectangle === null) {
        return [];
      }

      const selectionHighlightFrame = readSelectionHighlightFrame(elementRectangle);
      const visibleSelectionHighlightCorner = readVisibleSelectionHighlightCorner(
        selectionHighlightFrame,
        window.innerHeight,
        window.innerWidth,
      );
      const markerTop: number = visibleSelectionHighlightCorner.y - markerSize / 2;
      const markerLeft: number = visibleSelectionHighlightCorner.x - markerSize / 2;
      const isVisible: boolean =
        elementRectangle.width > 0 &&
        elementRectangle.height > 0 &&
        selectionHighlightFrame.top + selectionHighlightFrame.height >= 0 &&
        selectionHighlightFrame.left + selectionHighlightFrame.width >= 0 &&
        selectionHighlightFrame.top <= window.innerHeight &&
        selectionHighlightFrame.left <= window.innerWidth;

      return [
        {
          height: selectionHighlightFrame.height,
          isVisible,
          left: selectionHighlightFrame.left,
          markerLeft,
          markerNumber: selection.markerNumber,
          markerTop,
          top: selectionHighlightFrame.top,
          width: selectionHighlightFrame.width,
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
      {markerRenderModels.map((marker: ISelectionOverlayRenderModel) => {
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
