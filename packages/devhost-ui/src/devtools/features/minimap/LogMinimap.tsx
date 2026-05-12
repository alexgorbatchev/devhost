import type { CSSProperties, JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useDevtoolsTheme } from "../../shared";
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
  onHoveredChange: (isHovered: boolean) => void;
}

interface IPositionStyle extends CSSProperties {
  height?: number;
  top?: number;
}

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

  const minimapTransform: string = props.isHovered ? "translateX(0)" : "translateX(calc(100px - 20px))";

  return (
    <aside
      aria-hidden="true"
      className={cn(
        "pointer-events-auto fixed inset-y-0 right-0 z-[2147483500] box-border w-[100px] border-l border-border bg-muted p-1 transition-[opacity,transform] duration-150 ease-in-out",
        props.isHovered ? "opacity-100" : "opacity-50",
      )}
      data-testid="LogMinimap"
      style={{ transform: minimapTransform }}
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
          style={readPositionStyle(previewOverlay.top, previewOverlay.height)}
        />
      ) : null}
      {props.isHovered && previewLayout !== null && hoveredRowIndex !== null && previewRows.length > 0 ? (
        <div
          className="pointer-events-none absolute right-[calc(100%+8px)] z-[2147483500] grid w-[min(80ch,calc(100vw-164px))] gap-2 rounded-md border border-border bg-background p-2 text-xs leading-none text-foreground shadow-sm"
          data-testid="LogMinimap--preview"
          style={readPositionStyle(previewLayout.top)}
        >
          <ol className="grid list-none gap-0 p-0">
            {previewRows.map((row: IVisibleLogRow) => {
              return (
                <li
                  key={`${row.id}-${row.top}`}
                  className={cn(
                    "h-6 overflow-hidden text-ellipsis whitespace-pre px-2 leading-6",
                    row.stream === "stderr" ? "bg-destructive/10 text-destructive" : "text-foreground",
                  )}
                >
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

function readPixelValue(value: string): number {
  const parsedValue: number = Number.parseFloat(value);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function readPositionStyle(top: number, height?: number): IPositionStyle {
  return { height, top };
}
