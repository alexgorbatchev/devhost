import type { CSSProperties, JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../../../lib/utils";

import { useDevtoolsColorScheme } from "../../../shared";
import type { ServiceLogEntry } from "../../../shared/types";
import type { ILogAnsiFragment } from "../parseAnsiLogLine";
import { createLogMinimapMarksFromVisibleRows, type ILogMinimapMark } from "../createLogMinimapMarks";
import { createLogPreviewWindow } from "../createLogPreviewWindow";
import { createVisibleLogRows, type IVisibleLogRow } from "../createVisibleLogRows";
import { readLogMinimapPalette, type ILogMinimapPalette } from "../readLogMinimapPalette";
import { resolveHoveredLogRowIndex } from "../resolveHoveredLogRowIndex";
import { resolveLogPreviewLayout } from "../resolveLogPreviewLayout";
import { resolveLogPreviewOverlay } from "../resolveLogPreviewOverlay";
import type { IRenderCanvasFunction } from "../types";

interface ILogMinimapProps {
  entries: ServiceLogEntry[];
  isHovered: boolean;
  onHoveredChange: (isHovered: boolean) => void;
}

export function LogMinimap(props: ILogMinimapProps): JSX.Element | null {
  const colorScheme = useDevtoolsColorScheme();
  const palette: ILogMinimapPalette = readLogMinimapPalette(colorScheme);
  const canvasReference = useRef<HTMLCanvasElement | null>(null);
  const entriesReference = useRef<ServiceLogEntry[]>(props.entries);
  const marksReference = useRef<ILogMinimapMark[]>([]);
  const visibleRowsReference = useRef<IVisibleLogRow[]>([]);
  const renderCanvasReference = useRef<IRenderCanvasFunction>(() => {});
  const stderrColorReference = useRef<string>(palette.stderr);
  const stdoutColorReference = useRef<string>(palette.stdout);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);

  entriesReference.current = props.entries;
  stderrColorReference.current = palette.stderr;
  stdoutColorReference.current = palette.stdout;

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
  }, [palette.stderr, palette.stdout, props.entries]);

  const previewLayout = useMemo(() => {
    if (hoveredRowIndex === null) {
      return null;
    }

    return resolveLogPreviewLayout({
      borderWidth: 1,
      hoveredRowIndex,
      marks: marksReference.current,
      previewPadding: logPreviewPadding,
      rowGap: 0,
      rowHeight: logPreviewRowHeight,
      viewportHeight: canvasReference.current?.clientHeight ?? 0,
      viewportPadding: logPreviewViewportPadding,
    });
  }, [hoveredRowIndex]);
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

  return (
    <aside
      aria-hidden="true"
      className={cn(
        "pointer-events-auto fixed inset-y-0 right-0 z-[var(--devhost-z-floating)] box-border w-[100px] border-l border-border bg-muted p-1 transition-all duration-150 ease-in-out",
        props.isHovered ? "opacity-100" : "opacity-50",
      )}
      data-testid="LogMinimap"
      style={{
        transform: props.isHovered ? "translateX(0)" : "translateX(80px)",
      }}
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
      <canvas ref={canvasReference} className="block size-full pointer-events-none" data-testid="LogMinimap--canvas" />
      {props.isHovered && previewOverlay !== null ? (
        <div
          className="pointer-events-none absolute inset-x-1 bg-primary/10 shadow-[inset_0_0_0_1px_var(--ring)]"
          data-testid="LogMinimap--preview-overlay"
          style={{ height: previewOverlay.height, top: previewOverlay.top }}
        />
      ) : null}
      {props.isHovered && previewLayout !== null && hoveredRowIndex !== null && previewRows.length > 0 ? (
        <div
          className="pointer-events-none absolute right-[calc(100%+8px)] z-[var(--devhost-z-floating)] grid w-[min(80ch,calc(100vw-164px))] gap-2 rounded-md border border-border bg-background p-2 text-xs leading-none text-foreground shadow-sm"
          data-testid="LogMinimap--preview"
          style={{ top: previewLayout.top }}
        >
          <ol className="grid list-none gap-0 p-0">
            {previewRows.map((row: IVisibleLogRow) => {
              return (
                <li
                  key={`${row.id}-${row.top}`}
                  className={cn(
                    "h-6 overflow-hidden whitespace-pre px-2 leading-6",
                    row.stream === "stderr" ? "bg-destructive/10 text-destructive" : "text-foreground",
                  )}
                >
                  {row.fragments.length === 0
                    ? row.text
                    : row.fragments.map((fragment: ILogAnsiFragment, fragmentIndex: number) => {
                        return (
                          <span
                            key={`${row.id}-${row.top}-${fragmentIndex}`}
                            className={cn(
                              fragment.isBold ? "font-semibold" : null,
                              fragment.isDim ? "opacity-70" : null,
                              fragment.isItalic ? "italic" : null,
                              fragment.isStrikethrough ? "line-through" : null,
                              fragment.isUnderline ? "underline" : null,
                            )}
                            style={resolveAnsiFragmentStyle(fragment)}
                          >
                            {fragment.text}
                          </span>
                        );
                      })}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}

const logPreviewPadding: number = 8;
const logPreviewRowHeight: number = 24;
const logPreviewViewportPadding: number = 10;

function resolveAnsiFragmentStyle(fragment: ILogAnsiFragment): CSSProperties | undefined {
  if (fragment.backgroundColor === null && fragment.foregroundColor === null) {
    return undefined;
  }

  return {
    backgroundColor: fragment.backgroundColor ?? undefined,
    color: fragment.foregroundColor ?? undefined,
  };
}
