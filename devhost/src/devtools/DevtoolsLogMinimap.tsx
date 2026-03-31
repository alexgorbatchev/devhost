import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { DevtoolsMinimapPosition } from "../stackTypes";
import { createLogMinimapMarks, type ILogMinimapMark } from "./createLogMinimapMarks";
import type { IDevtoolsTheme } from "./devtoolsTheme";
import type { ServiceLogEntry } from "./types";

interface IDevtoolsLogMinimapProps {
  entries: ServiceLogEntry[];
  minimapPosition: DevtoolsMinimapPosition;
  theme: IDevtoolsTheme;
}

const minimapTransitionStyle: JSX.CSSProperties["transition"] = "opacity 160ms ease, transform 160ms ease";

export function DevtoolsLogMinimap(props: IDevtoolsLogMinimapProps): JSX.Element | null {
  const canvasReference = useRef<HTMLCanvasElement | null>(null);
  const entriesReference = useRef<ServiceLogEntry[]>(props.entries);
  const renderCanvasReference = useRef<() => void>(() => {});
  const stderrColorReference = useRef<string>(props.theme.colors.logMinimapStderr);
  const stdoutColorReference = useRef<string>(props.theme.colors.logMinimapStdout);
  const [isHovered, setIsHovered] = useState<boolean>(false);

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

      const marks: ILogMinimapMark[] = createLogMinimapMarks(entriesReference.current, renderHeight, renderWidth);

      for (const mark of marks) {
        context.fillStyle =
          mark.stream === "stderr" ? stderrColorReference.current : stdoutColorReference.current;
        context.fillRect(0, mark.top, mark.width, mark.height);
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

  if (props.entries.length === 0) {
    return null;
  }

  return (
    <aside
      aria-hidden="true"
      style={createMinimapStyle(props.theme, props.minimapPosition, isHovered)}
      data-testid="DevtoolsLogMinimap"
      onMouseEnter={(): void => {
        setIsHovered(true);
      }}
      onMouseLeave={(): void => {
        setIsHovered(false);
      }}
    >
      <canvas ref={canvasReference} style={canvasStyle} data-testid="DevtoolsLogMinimap--canvas" />
    </aside>
  );
}

const canvasStyle: JSX.CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
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
