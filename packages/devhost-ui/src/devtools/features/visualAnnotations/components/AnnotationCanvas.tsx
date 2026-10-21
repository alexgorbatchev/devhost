import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX, type PointerEvent } from "react";

import { cn } from "../../../../lib/utils";
import { createAnnotationShape } from "../createAnnotationShape";
import type { AnnotationShapeKind, IAnnotationPoint, IAnnotationShape } from "../types";

interface IAnnotationCanvasProps {
  shapes: IAnnotationShape[];
  tool: AnnotationShapeKind | null;
  onDraw: (shape: IAnnotationShape) => void;
}

interface IShapeGesture {
  pointerId: number;
  kind: AnnotationShapeKind;
  start: IAnnotationPoint;
}

/** Document-coordinate drawings stay with page content when the main viewport scrolls. */
export function AnnotationCanvas({ shapes, tool, onDraw }: IAnnotationCanvasProps): JSX.Element {
  const arrowId = useId();
  const canvasReference = useRef<SVGSVGElement | null>(null);
  const gesture = useRef<IShapeGesture | null>(null);
  const [preview, setPreview] = useState<IAnnotationShape | null>(null);
  const [viewBox, setViewBox] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const canvas = canvasReference.current;
    if (canvas === null) {
      return;
    }
    const refresh = (): void => {
      const bounds = canvas.getBoundingClientRect();
      setViewBox(`${window.scrollX + bounds.x} ${window.scrollY + bounds.y} ${bounds.width} ${bounds.height}`);
    };
    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(canvas);
    const cancel = (): void => {
      gesture.current = null;
      setPreview(null);
    };
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh);
    window.addEventListener("blur", cancel);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(() => {
    gesture.current = null;
    setPreview(null);
  }, [tool]);

  const cancelGesture = (): void => {
    gesture.current = null;
    setPreview(null);
  };
  const move = (event: PointerEvent<SVGSVGElement>): void => {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    setPreview(createAnnotationShape("preview", active.kind, active.start, readPoint(event)));
  };
  const finish = (event: PointerEvent<SVGSVGElement>): void => {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    const shape = createAnnotationShape(crypto.randomUUID(), active.kind, active.start, readPoint(event));
    cancelGesture();
    if (shape !== null) {
      onDraw(shape);
    }
  };
  return (
    <svg
      ref={canvasReference}
      aria-label="Annotation drawing canvas"
      className={cn(
        "fixed inset-0 z-(--devhost-z-overlay) size-full overflow-visible text-mark",
        tool === null ? "pointer-events-none" : "pointer-events-auto touch-none cursor-crosshair",
      )}
      data-testid="AnnotationCanvas"
      role="img"
      viewBox={viewBox}
      onLostPointerCapture={cancelGesture}
      onPointerCancel={cancelGesture}
      onPointerDown={(event) => {
        if (tool === null || event.button !== 0 || gesture.current !== null) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { pointerId: event.pointerId, kind: tool, start: readPoint(event) };
      }}
      onPointerMove={move}
      onPointerUp={finish}
    >
      <defs>
        <marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" viewBox="0 0 8 8">
          <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
        </marker>
      </defs>
      {[...shapes, ...(preview === null ? [] : [preview])].map((shape) => (
        <AnnotationShape key={shape.id} shape={shape} arrowId={arrowId} />
      ))}
    </svg>
  );
}

interface IAnnotationShapeProps {
  shape: IAnnotationShape;
  arrowId: string;
}

function AnnotationShape({ shape, arrowId }: IAnnotationShapeProps): JSX.Element {
  return (
    <g
      aria-label={`${shape.kind} annotation`}
      role="img"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shape.kind === "box" ? (
        <rect
          x={shape.start.x}
          y={shape.start.y}
          width={shape.end.x - shape.start.x}
          height={shape.end.y - shape.start.y}
        />
      ) : (
        <line
          x1={shape.start.x}
          y1={shape.start.y}
          x2={shape.end.x}
          y2={shape.end.y}
          markerEnd={shape.kind === "arrow" ? `url(#${arrowId})` : undefined}
        />
      )}
    </g>
  );
}

function readPoint(event: PointerEvent<SVGSVGElement>): IAnnotationPoint {
  return { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };
}
