import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../../lib/utils";
import { resolveDevtoolsPortalContainer } from "../resolveDevtoolsPortalContainer";

interface IHighlightFrame {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface IHighlightOverlayRenderModel extends IHighlightFrame {
  badge?: ReactNode;
  badgeLeft: number;
  badgeTop: number;
  id: string | number;
  isVisible: boolean;
  label?: ReactNode;
  labelTop: number;
}

type HighlightOverlayAppearance = "hover" | "selected";

interface IViewportPosition {
  x: number;
  y: number;
}

export interface IHighlightOverlayRectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface IHighlightOverlayItem {
  badge?: ReactNode;
  id: string | number;
  label?: ReactNode;
  readRectangle: () => IHighlightOverlayRectangle | null;
}

interface IHighlightOverlayProps {
  appearance?: HighlightOverlayAppearance;
  badgeTestId?: string;
  highlightTestId?: string;
  highlights: IHighlightOverlayItem[];
  labelTestId?: string;
  rootTestId?: string;
}

const highlightHorizontalPadding: number = 3;
const highlightVerticalPadding: number = 3;
const badgeSize: number = 18;
const labelHeight: number = 18;
const labelGap: number = 6;

export function HighlightOverlay({
  appearance = "selected",
  badgeTestId = "HighlightOverlay--badge",
  highlightTestId = "HighlightOverlay--highlight",
  highlights,
  labelTestId = "HighlightOverlay--label",
  rootTestId = "HighlightOverlay",
}: IHighlightOverlayProps): JSX.Element {
  const portalAnchorReference = useRef<HTMLSpanElement | null>(null);
  const scheduledFrameReference = useRef<number | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [, setLayoutVersion] = useState<number>(0);

  useLayoutEffect(() => {
    const anchorElement: HTMLSpanElement | null = portalAnchorReference.current;

    if (anchorElement === null) {
      return;
    }

    setPortalTarget(resolveDevtoolsPortalContainer(anchorElement));
  }, []);

  useLayoutEffect(() => {
    if (highlights.length === 0) {
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
  }, [highlights.length]);

  useLayoutEffect(() => {
    if (portalTarget === null || highlights.length === 0) {
      return;
    }

    const ownerWindow: Window | null = portalTarget.ownerDocument.defaultView;

    if (ownerWindow === null) {
      return;
    }

    const animationFrameId: number = ownerWindow.requestAnimationFrame((): void => {
      setLayoutVersion((currentVersion: number): number => currentVersion + 1);
    });

    return () => {
      ownerWindow.cancelAnimationFrame(animationFrameId);
    };
  }, [highlights.length, portalTarget]);

  const renderModels: IHighlightOverlayRenderModel[] = highlights.flatMap(
    (highlight: IHighlightOverlayItem): IHighlightOverlayRenderModel[] => {
      const rectangle: IHighlightOverlayRectangle | null = highlight.readRectangle();

      if (rectangle === null) {
        return [];
      }

      const highlightFrame = readHighlightFrame(rectangle);
      const visibleHighlightCorner = readVisibleHighlightCorner(highlightFrame, window.innerHeight, window.innerWidth);
      const isVisible: boolean =
        rectangle.width > 0 &&
        rectangle.height > 0 &&
        highlightFrame.top + highlightFrame.height >= 0 &&
        highlightFrame.left + highlightFrame.width >= 0 &&
        highlightFrame.top <= window.innerHeight &&
        highlightFrame.left <= window.innerWidth;

      return [
        {
          badge: highlight.badge,
          badgeLeft: visibleHighlightCorner.x - badgeSize / 2,
          badgeTop: visibleHighlightCorner.y - badgeSize / 2,
          height: highlightFrame.height,
          id: highlight.id,
          isVisible,
          label: highlight.label,
          labelTop: readLabelTop(highlightFrame, window.innerHeight),
          left: highlightFrame.left,
          top: highlightFrame.top,
          width: highlightFrame.width,
        },
      ];
    },
  );

  const overlayRootTestId: string | undefined = rootTestId === "HighlightOverlay" ? undefined : rootTestId;
  const overlay = (
    <div data-testid={overlayRootTestId} className="pointer-events-none fixed inset-0">
      {renderModels.map((highlight: IHighlightOverlayRenderModel) => {
        if (!highlight.isVisible) {
          return null;
        }

        return (
          <div key={highlight.id}>
            <div
              className={cn(
                "pointer-events-none fixed z-(--devhost-z-overlay) box-border rounded-sm border-2 border-mark shadow-mark",
                appearance === "hover" ? "border-dashed" : "bg-mark/10",
              )}
              data-appearance={appearance}
              data-testid={highlightTestId}
              style={{
                height: highlight.height,
                left: highlight.left,
                top: highlight.top,
                width: highlight.width,
              }}
            />
            {highlight.badge !== undefined ? (
              <div
                className={[
                  "pointer-events-none fixed z-(--devhost-z-overlay) grid h-4.5 min-w-4.5 place-items-center rounded-full",
                  "bg-mark px-1 text-sm font-bold text-mark-foreground shadow-mark-badge",
                ].join(" ")}
                data-testid={badgeTestId}
                style={{
                  left: highlight.badgeLeft,
                  top: highlight.badgeTop,
                }}
              >
                {highlight.badge}
              </div>
            ) : null}
            {highlight.label !== undefined ? (
              <div
                className={[
                  "pointer-events-none fixed z-(--devhost-z-overlay) h-4.5 max-w-105 truncate rounded-sm border",
                  "border-mark bg-mark-halo-outer px-1.5 text-sm/4 text-mark-halo-inner",
                ].join(" ")}
                data-testid={labelTestId}
                style={{
                  left: Math.max(4, highlight.left),
                  top: highlight.labelTop,
                }}
              >
                {highlight.label}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <span data-testid="HighlightOverlay" ref={portalAnchorReference} hidden>
      {portalTarget === null ? null : createPortal(overlay, portalTarget)}
    </span>
  );
}

// Labels sit above the highlight, or below it when the highlight touches the top of the viewport.
function readLabelTop(highlightFrame: IHighlightFrame, viewportHeight: number): number {
  const aboveTop: number = highlightFrame.top - labelHeight - labelGap;

  if (aboveTop >= 4) {
    return aboveTop;
  }

  return Math.min(highlightFrame.top + highlightFrame.height + labelGap, viewportHeight - labelHeight - 4);
}

function readHighlightFrame(rectangle: IHighlightOverlayRectangle): IHighlightFrame {
  return {
    height: rectangle.height + highlightVerticalPadding * 2,
    left: rectangle.x - highlightHorizontalPadding,
    top: rectangle.y - highlightVerticalPadding,
    width: rectangle.width + highlightHorizontalPadding * 2,
  };
}

function readVisibleHighlightCorner(
  highlightFrame: IHighlightFrame,
  viewportHeight: number,
  viewportWidth: number,
): IViewportPosition {
  return {
    x: Math.min(Math.max(highlightFrame.left, 0), viewportWidth),
    y: Math.min(Math.max(highlightFrame.top, 0), viewportHeight),
  };
}
