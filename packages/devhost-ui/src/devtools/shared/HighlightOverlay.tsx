import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { DEVTOOLS_ROOT_ATTRIBUTE_NAME, DEVTOOLS_ROOT_ID } from "./constants";
import type { IDevtoolsTheme } from "./devtoolsTheme";
import { useDevtoolsTheme } from "./useDevtoolsTheme";

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

interface IHighlightBadgeStyle extends CSSProperties {
  backgroundColor: string;
  color: string;
  left: number;
  pointerEvents: "none";
  position: "fixed";
  top: number;
  zIndex: NonNullable<CSSProperties["zIndex"]>;
}

interface IHighlightFrameStyle extends CSSProperties {
  borderColor: string;
  height: number;
  left: number;
  pointerEvents: "none";
  position: "fixed";
  top: number;
  width: number;
  zIndex: NonNullable<CSSProperties["zIndex"]>;
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
              className="pointer-events-none fixed box-border rounded-sm border-2"
              data-testid={highlightTestId}
              style={createHighlightStyle(theme, highlight)}
            />
            {highlight.badge !== undefined ? (
              <div
                className={[
                  "pointer-events-none fixed grid size-6 place-items-center",
                  "rounded-full font-mono text-xs font-bold shadow-md",
                ].join(" ")}
                data-testid={badgeTestId}
                style={createBadgeStyle(theme, highlight)}
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

function createBadgeStyle(theme: IDevtoolsTheme, highlight: IHighlightOverlayRenderModel): IHighlightBadgeStyle {
  return {
    backgroundColor: theme.colors.highlightBackground,
    color: theme.colors.highlightForeground,
    top: highlight.badgeTop,
    left: highlight.badgeLeft,
    pointerEvents: "none",
    position: "fixed",
    zIndex: theme.zIndices.floating,
  };
}

function createHighlightStyle(theme: IDevtoolsTheme, highlight: IHighlightFrame): IHighlightFrameStyle {
  return {
    borderColor: theme.colors.highlightBackground,
    top: highlight.top,
    left: highlight.left,
    width: highlight.width,
    height: highlight.height,
    pointerEvents: "none",
    position: "fixed",
    zIndex: theme.zIndices.floating,
  };
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
