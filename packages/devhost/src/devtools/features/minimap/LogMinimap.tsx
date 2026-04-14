import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DevtoolsMinimapPosition } from "../../../types/stackTypes";
import { css, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";
import type { ServiceLogEntry } from "../../shared/types";
import { createLogMinimapMarksFromVisibleRows, type ILogMinimapMark } from "./createLogMinimapMarks";
import { createLogPreviewWindow } from "./createLogPreviewWindow";
import { createVisibleLogRows, type IVisibleLogRow } from "./createVisibleLogRows";
import { resolveHoveredLogRowIndex } from "./resolveHoveredLogRowIndex";
import { resolveLogPreviewLayout } from "./resolveLogPreviewLayout";
import { resolveLogPreviewOverlay } from "./resolveLogPreviewOverlay";
import type { IRenderCanvasFunction } from "./types";

interface ILogMinimapProps {
  entries: ServiceLogEntry[];
  isHovered: boolean;
  minimapPosition: DevtoolsMinimapPosition;
  onHoveredChange: (isHovered: boolean) => void;
}

const minimapTransitionStyle: CSSObject["transition"] = "opacity 160ms ease, transform 160ms ease";

export function LogMinimap(props: ILogMinimapProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
  const canvasReference = useRef<HTMLCanvasElement | null>(null);
  const entriesReference = useRef<ServiceLogEntry[]>(props.entries);
  const marksReference = useRef<ILogMinimapMark[]>([]);
  const visibleRowsReference = useRef<IVisibleLogRow[]>([]);
  const renderCanvasReference = useRef<IRenderCanvasFunction>(() => {});
  const stderrColorReference = useRef<string>(theme.colors.logMinimapStderr);
  const stdoutColorReference = useRef<string>(theme.colors.logMinimapStdout);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);

  entriesReference.current = props.entries;
  stderrColorReference.current = theme.colors.logMinimapStderr;
  stdoutColorReference.current = theme.colors.logMinimapStdout;

  useEffect(() => {
    const canvas: HTMLCanvasElement | null = canvasReference.current;

    if (canvas === null) {
      return;
    }

    const renderCanvas = (): void => {
      const context: CanvasRenderingContext2D | null = canvas.getContext("2d");

      if (context === null) {
        return;
      }

      const cssWidth: number = Math.max(1, Math.floor(canvas.clientWidth));
      const cssHeight: number = Math.max(1, Math.floor(canvas.clientHeight));
      const devicePixelRatio: number = Math.max(1, window.devicePixelRatio || 1);
      const renderWidth: number = Math.max(1, Math.round(cssWidth * devicePixelRatio));
      const renderHeight: number = Math.max(1, Math.round(cssHeight * devicePixelRatio));

      if (canvas.width !== renderWidth) {
        canvas.width = renderWidth;
      }

      if (canvas.height !== renderHeight) {
        canvas.height = renderHeight;
      }

      context.clearRect(0, 0, renderWidth, renderHeight);

      const visibleRows: IVisibleLogRow[] = createVisibleLogRows(entriesReference.current, cssHeight, cssWidth);
      const marks: ILogMinimapMark[] = createLogMinimapMarksFromVisibleRows(visibleRows);

      visibleRowsReference.current = visibleRows;
      marksReference.current = marks;

      for (const mark of marks) {
        context.fillStyle = mark.stream === "stderr" ? stderrColorReference.current : stdoutColorReference.current;
        context.fillRect(
          0,
          Math.round(mark.top * devicePixelRatio),
          Math.round(mark.width * devicePixelRatio),
          Math.max(1, Math.round(mark.height * devicePixelRatio)),
        );
      }
    };

    renderCanvasReference.current = renderCanvas;
    renderCanvas();

    const resizeObserver: ResizeObserver = new ResizeObserver((): void => {
      renderCanvas();
    });

    resizeObserver.observe(canvas);
    window.addEventListener("resize", renderCanvas);

    return () => {
      renderCanvasReference.current = () => {};
      resizeObserver.disconnect();
      window.removeEventListener("resize", renderCanvas);
    };
  }, []);

  useEffect(() => {
    renderCanvasReference.current();
  }, [props.entries, theme.colors.logMinimapStderr, theme.colors.logMinimapStdout]);

  const previewLayout = useMemo(() => {
    if (hoveredRowIndex === null) {
      return null;
    }

    return resolveLogPreviewLayout({
      borderWidth: 1,
      hoveredRowIndex,
      marks: marksReference.current,
      previewPadding: readPixelValue(theme.spacing.xs),
      rowGap: 0,
      rowHeight: readPixelValue(theme.sizes.logPreviewRowHeight),
      viewportHeight: canvasReference.current?.clientHeight ?? 0,
      viewportPadding: readPixelValue(theme.spacing.sm),
    });
  }, [hoveredRowIndex, theme]);
  const previewRows: IVisibleLogRow[] = useMemo((): IVisibleLogRow[] => {
    if (hoveredRowIndex === null || previewLayout === null) {
      return [];
    }

    return createLogPreviewWindow(
      visibleRowsReference.current,
      hoveredRowIndex,
      previewLayout.range.endIndex - previewLayout.range.startIndex,
    );
  }, [hoveredRowIndex, previewLayout]);
  const previewOverlay = resolveLogPreviewOverlay(marksReference.current, previewLayout?.range ?? null);

  if (props.entries.length === 0) {
    return null;
  }

  const canvasClassName: string = css(canvasStyle);
  const minimapClassName: string = css(createMinimapStyle(theme, props.minimapPosition, props.isHovered));
  const previewClassName: string =
    previewLayout === null ? "" : css(createPreviewStyle(theme, props.minimapPosition, previewLayout.top));
  const previewListClassName: string = css(createPreviewListStyle());

  return (
    <aside
      aria-hidden="true"
      className={minimapClassName}
      data-testid="LogMinimap"
      onMouseEnter={(): void => {
        props.onHoveredChange(true);
      }}
      onMouseLeave={(): void => {
        props.onHoveredChange(false);
        setHoveredRowIndex(null);
      }}
      onMouseMove={(event: React.MouseEvent<HTMLElement>): void => {
        const currentTargetRectangle: DOMRect = event.currentTarget.getBoundingClientRect();
        const mouseOffsetY: number = event.clientY - currentTargetRectangle.top;

        setHoveredRowIndex(resolveHoveredLogRowIndex(marksReference.current, mouseOffsetY));
      }}
    >
      <canvas ref={canvasReference} className={canvasClassName} data-testid="LogMinimap--canvas" />
      {props.isHovered && previewOverlay !== null ? (
        <div
          className={css(createOverlayStyle(theme, previewOverlay.top, previewOverlay.height))}
          data-testid="LogMinimap--preview-overlay"
        />
      ) : null}
      {props.isHovered && previewLayout !== null && hoveredRowIndex !== null && previewRows.length > 0 ? (
        <div className={previewClassName} data-testid="LogMinimap--preview">
          <ol className={previewListClassName}>
            {previewRows.map((row: IVisibleLogRow) => {
              return (
                <li key={`${row.id}-${row.top}`} className={css(readPreviewLineStyle(theme, row.stream))}>
                  {row.text}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}

const canvasStyle: CSSObject = {
  display: "block",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};

const overlayShadowStyle: CSSObject["boxShadow"] = "inset 0 0 0 1px";

function readPreviewLineStyle(theme: IDevtoolsTheme, stream: ServiceLogEntry["stream"]): CSSObject {
  const isStderr: boolean = stream === "stderr";

  return {
    background: isStderr ? theme.colors.logPreviewStderrBackground : undefined,
    boxSizing: "border-box",
    color: isStderr ? theme.colors.logPreviewStderrForeground : theme.colors.foreground,
    height: theme.sizes.logPreviewRowHeight,
    lineHeight: theme.sizes.logPreviewRowHeight,
    overflow: "hidden",
    padding: `0 ${theme.spacing.xs}`,
    textOverflow: "ellipsis",
    whiteSpace: "pre",
  };
}

function createPreviewListStyle(): CSSObject {
  return {
    display: "grid",
    gap: 0,
    listStyle: "none",
    margin: 0,
    padding: 0,
  };
}

function createMinimapStyle(
  theme: IDevtoolsTheme,
  minimapPosition: DevtoolsMinimapPosition,
  isHovered: boolean,
): CSSObject {
  const edgeStyle: CSSObject =
    minimapPosition === "left"
      ? {
          borderRight: `1px solid ${theme.colors.border}`,
          left: 0,
        }
      : {
          borderLeft: `1px solid ${theme.colors.border}`,
          right: 0,
        };

  return {
    ...edgeStyle,
    position: "fixed",
    top: 0,
    bottom: 0,
    width: theme.sizes.logMinimapWidth,
    padding: theme.spacing.xxs,
    boxSizing: "border-box",
    background: theme.colors.logMinimapBackground,
    opacity: isHovered ? theme.opacities.logMinimapActive : theme.opacities.logMinimapResting,
    pointerEvents: "auto",
    transform: resolveMinimapTransform(theme, minimapPosition, isHovered),
    transition: minimapTransitionStyle,
    zIndex: theme.zIndices.floating,
  };
}

function createOverlayStyle(theme: IDevtoolsTheme, top: number, height: number): CSSObject {
  return {
    position: "absolute",
    top,
    left: theme.spacing.xxs,
    right: theme.spacing.xxs,
    height,
    background: theme.colors.logMinimapOverlayBackground,
    boxShadow: `${overlayShadowStyle} ${theme.colors.logMinimapOverlayBorder}`,
    pointerEvents: "none",
  };
}

function createPreviewStyle(theme: IDevtoolsTheme, minimapPosition: DevtoolsMinimapPosition, top: number): CSSObject {
  const horizontalPositionStyle: CSSObject =
    minimapPosition === "left"
      ? {
          left: `calc(100% + ${theme.spacing.xs})`,
        }
      : {
          right: `calc(100% + ${theme.spacing.xs})`,
        };

  return {
    ...horizontalPositionStyle,
    position: "absolute",
    top,
    width: `min(${theme.sizes.logPreviewWidth}, calc(100vw - ${theme.sizes.logMinimapWidth} - ${theme.spacing.xl}))`,
    display: "grid",
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    background: theme.colors.background,
    boxShadow: theme.shadows.floating,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    lineHeight: 1,
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}

function readPixelValue(value: string): number {
  const parsedValue: number = Number.parseFloat(value);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function resolveMinimapTransform(
  theme: IDevtoolsTheme,
  minimapPosition: DevtoolsMinimapPosition,
  isHovered: boolean,
): string {
  if (isHovered) {
    return "translateX(0)";
  }

  const hiddenDistance: string = `calc(${theme.sizes.logMinimapWidth} - ${theme.sizes.logMinimapPeekWidth})`;

  return minimapPosition === "left" ? `translateX(calc(-1 * ${hiddenDistance}))` : `translateX(${hiddenDistance})`;
}
