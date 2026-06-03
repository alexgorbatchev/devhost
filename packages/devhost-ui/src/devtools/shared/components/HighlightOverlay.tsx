import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
}

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
  readRectangle: () => IHighlightOverlayRectangle | null;
}

interface IHighlightOverlayProps {
  badgeTestId?: string;
  highlightTestId?: string;
  highlights: IHighlightOverlayItem[];
  rootTestId?: string;
}

const highlightHorizontalPadding: number = 2;
const highlightVerticalPadding: number = 1;
const badgeSize: number = 24;

export function HighlightOverlay({
  badgeTestId = "HighlightOverlay--badge",
  highlightTestId = "HighlightOverlay--highlight",
  highlights,
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
              className="pointer-events-none fixed z-[var(--devhost-z-floating)] box-border rounded-sm border-2"
              data-testid={highlightTestId}
              style={{
                height: highlight.height,
                left: highlight.left,
                top: highlight.top,
                width: highlight.width,
                borderColor: "var(--devhost-highlight-background)",
              }}
            />
            {highlight.badge !== undefined ? (
              <div
                className={[
                  "pointer-events-none fixed z-[var(--devhost-z-floating)] grid size-6 place-items-center",
                  "rounded-full font-mono text-xs font-bold shadow-md",
                ].join(" ")}
                data-testid={badgeTestId}
                style={{
                  left: highlight.badgeLeft,
                  top: highlight.badgeTop,
                  backgroundColor: "var(--devhost-highlight-background)",
                  color: "var(--devhost-highlight-foreground)",
                }}
              >
                {highlight.badge}
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
