import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX, type PointerEvent } from "react";

import { cn } from "../../../../lib/utils";
import { createAnnotationShape } from "../createAnnotationShape";
import type { AnnotationShapeKind, IAnnotationPoint, IAnnotationShape } from "../types";

interface IAnnotationCanvasProps {
  shapes: IAnnotationShape[];
  tool: AnnotationShapeKind | null;
  onDraw: (shape: IAnnotationShape) => void;
  onMove?: (shape: IAnnotationShape) => void;
  isDisabled?: boolean;
}

interface IShapeGesture {
  pointerId: number;
  kind: AnnotationShapeKind;
  start: IAnnotationPoint;
  original?: IAnnotationShape;
}

/** Document-coordinate drawings stay with page content when the main viewport scrolls. */
export function AnnotationCanvas({
  shapes,
  tool,
  onDraw,
  onMove,
  isDisabled = false,
}: IAnnotationCanvasProps): JSX.Element {
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
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    gesture.current = null;
    setPreview(null);
  }, [tool, isDisabled]);

  const cancelGesture = (): void => {
    gesture.current = null;
    setPreview(null);
  };
  const move = (event: PointerEvent<SVGSVGElement>): void => {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    setPreview(gestureShape(active, readPoint(event)));
  };
  const finish = (event: PointerEvent<SVGSVGElement>): void => {
    const active = gesture.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    const shape = gestureShape(active, readPoint(event));
    cancelGesture();
    if (shape !== null) {
      if (active.original) onMove?.(shape);
      else onDraw({ ...shape, id: crypto.randomUUID() });
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
        if (isDisabled || event.button !== 0 || gesture.current !== null) {
          return;
        }
        const target = event.target;
        const shapeId =
          target instanceof Element ? target.closest("[data-shape-id]")?.getAttribute("data-shape-id") : null;
        const original = tool === null ? shapes.find((shape) => shape.id === shapeId) : undefined;
        if (tool === null && (!original || !onMove)) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = {
          pointerId: event.pointerId,
          kind: original?.kind ?? tool ?? "arrow",
          start: readPoint(event),
          original,
        };
      }}
      onPointerMove={move}
      onPointerUp={finish}
    >
      <defs>
        <marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" viewBox="0 0 8 8">
          <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
        </marker>
      </defs>
      {[...shapes.filter((shape) => shape.id !== preview?.id), ...(preview === null ? [] : [preview])].map((shape) => (
        <AnnotationShape
          key={shape.id}
          shape={shape}
          arrowId={arrowId}
          canMove={!isDisabled && tool === null && onMove !== undefined}
        />
      ))}
    </svg>
  );
}

interface IAnnotationShapeProps {
  shape: IAnnotationShape;
  arrowId: string;
  canMove: boolean;
}

function AnnotationShape({ shape, arrowId, canMove }: IAnnotationShapeProps): JSX.Element {
  return (
    <g
      aria-label={`${shape.kind} annotation`}
      data-shape-id={shape.id}
      className={canMove ? "pointer-events-auto touch-none cursor-move" : "pointer-events-none"}
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

function gestureShape(gesture: IShapeGesture, point: IAnnotationPoint): IAnnotationShape | null {
  if (!gesture.original) return createAnnotationShape("preview", gesture.kind, gesture.start, point);
  const { original, start } = gesture;
  const x = point.x - start.x;
  const y = point.y - start.y;
  return {
    ...original,
    start: { x: original.start.x + x, y: original.start.y + y },
    end: { x: original.end.x + x, y: original.end.y + y },
  };
}
