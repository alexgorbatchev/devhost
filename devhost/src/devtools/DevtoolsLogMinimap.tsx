import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { DevtoolsMinimapPosition } from "../stackTypes";
import { createLogMinimapMarks, type ILogMinimapMark } from "./createLogMinimapMarks";
import { createLogPreviewRange } from "./createLogPreviewRange";
import { createLogPreviewWindow } from "./createLogPreviewWindow";
import type { IDevtoolsTheme } from "./devtoolsTheme";
import { resolveHoveredLogEntryIndex } from "./resolveHoveredLogEntryIndex";
import { resolveLogPreviewOverlay } from "./resolveLogPreviewOverlay";
import type { ServiceLogEntry } from "./types";

interface IDevtoolsLogMinimapProps {
  entries: ServiceLogEntry[];
  isHovered: boolean;
  minimapPosition: DevtoolsMinimapPosition;
  onHoveredChange: (isHovered: boolean) => void;
  theme: IDevtoolsTheme;
}

const minimapTransitionStyle: JSX.CSSProperties["transition"] = "opacity 160ms ease, transform 160ms ease";

export function DevtoolsLogMinimap(props: IDevtoolsLogMinimapProps): JSX.Element | null {
  const canvasReference = useRef<HTMLCanvasElement | null>(null);
  const entriesReference = useRef<ServiceLogEntry[]>(props.entries);
  const marksReference = useRef<ILogMinimapMark[]>([]);
  const renderCanvasReference = useRef<() => void>(() => {});
  const stderrColorReference = useRef<string>(props.theme.colors.logMinimapStderr);
  const stdoutColorReference = useRef<string>(props.theme.colors.logMinimapStdout);
  const [hoveredEntryIndex, setHoveredEntryIndex] = useState<number | null>(null);

  entriesReference.current = props.entries;
  stderrColorReference.current = props.theme.colors.logMinimapStderr;
  stdoutColorReference.current = props.theme.colors.logMinimapStdout;

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

      const marks: ILogMinimapMark[] = createLogMinimapMarks(entriesReference.current, cssHeight, cssWidth);

      marksReference.current = marks;

      for (const mark of marks) {
        context.fillStyle =
          mark.stream === "stderr" ? stderrColorReference.current : stdoutColorReference.current;
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
  }, [props.entries, props.theme.colors.logMinimapStderr, props.theme.colors.logMinimapStdout]);

  const previewRange = useMemo(() => {
    if (hoveredEntryIndex === null) {
      return null;
    }

    return createLogPreviewRange(props.entries.length, hoveredEntryIndex);
  }, [hoveredEntryIndex, props.entries.length]);
  const previewEntries: ServiceLogEntry[] = useMemo((): ServiceLogEntry[] => {
    if (hoveredEntryIndex === null) {
      return [];
    }

    return createLogPreviewWindow(props.entries, hoveredEntryIndex);
  }, [hoveredEntryIndex, props.entries]);
  const previewOverlay = resolveLogPreviewOverlay(marksReference.current, previewRange);

  const hoveredEntry: ServiceLogEntry | null =
    hoveredEntryIndex === null ? null : props.entries.at(hoveredEntryIndex) ?? null;

  if (props.entries.length === 0) {
    return null;
  }

  return (
    <aside
      aria-hidden="true"
      style={createMinimapStyle(props.theme, props.minimapPosition, props.isHovered)}
      data-testid="DevtoolsLogMinimap"
      onMouseEnter={(): void => {
        props.onHoveredChange(true);
      }}
      onMouseLeave={(): void => {
        props.onHoveredChange(false);
        setHoveredEntryIndex(null);
      }}
      onMouseMove={(event: MouseEvent): void => {
        const currentTargetRectangle: DOMRect = event.currentTarget.getBoundingClientRect();
        const mouseOffsetY: number = event.clientY - currentTargetRectangle.top;

        setHoveredEntryIndex(resolveHoveredLogEntryIndex(marksReference.current, mouseOffsetY));
      }}
    >
      <canvas ref={canvasReference} style={canvasStyle} data-testid="DevtoolsLogMinimap--canvas" />
      {props.isHovered && previewOverlay !== null ? (
        <div
          style={createOverlayStyle(props.theme, previewOverlay.top, previewOverlay.height)}
          data-testid="DevtoolsLogMinimap--preview-overlay"
        />
      ) : null}
      {props.isHovered && hoveredEntry !== null && previewEntries.length > 0 ? (
        <div style={createPreviewStyle(props.theme, props.minimapPosition)} data-testid="DevtoolsLogMinimap--preview">
          <div style={previewHeaderStyle}>
            <span style={createPreviewBadgeStyle(props.theme, hoveredEntry.stream)}>{hoveredEntry.stream}</span>
            <span style={createPreviewServiceNameStyle(props.theme)}>{hoveredEntry.serviceName}</span>
          </div>
          <ol style={previewListStyle}>
            {previewEntries.map((entry: ServiceLogEntry) => {
              return (
                <li
                  key={entry.id}
                  style={createPreviewLineStyle(props.theme, hoveredEntry.id === entry.id, entry.stream)}
                >
                  {entry.line}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}

const canvasStyle: JSX.CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};

const previewHeaderStyle: JSX.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const overlayShadowStyle: JSX.CSSProperties["boxShadow"] = "inset 0 0 0 1px";

const previewListStyle: JSX.CSSProperties = {
  display: "grid",
  gap: "6px",
  listStyle: "none",
  margin: 0,
  maxHeight: "min(50vh, 420px)",
  overflow: "hidden",
  padding: 0,
};

function createMinimapStyle(
  theme: IDevtoolsTheme,
  minimapPosition: DevtoolsMinimapPosition,
  isHovered: boolean,
): JSX.CSSProperties {
  const edgeStyle: JSX.CSSProperties =
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

function createOverlayStyle(theme: IDevtoolsTheme, top: number, height: number): JSX.CSSProperties {
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

function createPreviewStyle(theme: IDevtoolsTheme, minimapPosition: DevtoolsMinimapPosition): JSX.CSSProperties {
  const horizontalPositionStyle: JSX.CSSProperties =
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
    top: theme.spacing.sm,
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
    lineHeight: 1.35,
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}

function createPreviewBadgeStyle(theme: IDevtoolsTheme, stream: ServiceLogEntry["stream"]): JSX.CSSProperties {
  return {
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    borderRadius: theme.radii.pill,
    background: stream === "stderr" ? theme.colors.dangerBackground : theme.colors.foreground,
    color: stream === "stderr" ? theme.colors.dangerForeground : theme.colors.background,
    fontSize: theme.fontSizes.sm,
  };
}

function createPreviewServiceNameStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
  };
}

function createPreviewLineStyle(
  theme: IDevtoolsTheme,
  isHighlighted: boolean,
  stream: ServiceLogEntry["stream"],
): JSX.CSSProperties {
  return {
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    borderRadius: theme.radii.md,
    boxShadow: isHighlighted ? `inset 0 0 0 1px ${theme.colors.border}` : undefined,
    color: stream === "stderr" ? theme.colors.dangerForeground : theme.colors.foreground,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
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
