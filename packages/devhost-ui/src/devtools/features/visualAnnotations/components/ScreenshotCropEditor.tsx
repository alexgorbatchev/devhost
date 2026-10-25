import { Input } from "@alexgorbatchev/shadcn";
import { NumberField } from "@base-ui/react/number-field";
import { useId, useRef, type JSX, type PointerEvent } from "react";
import { getScreenshotArea } from "../getScreenshotArea";
import type { IAnnotationPoint, IScreenshotArea, ITabSnapshot } from "../types";

interface IScreenshotCropEditorProps {
  snapshot: ITabSnapshot;
  area: IScreenshotArea | null;
  isDisabled: boolean;
  onAreaChange: (area: IScreenshotArea | null) => void;
}
interface IScreenshotDrag {
  start: IAnnotationPoint;
  pointerId: number;
  previous: IScreenshotArea | null;
}
interface IScreenshotCoordinate {
  key: keyof IScreenshotArea;
  label: string;
  min: number;
  max: number;
}

export function ScreenshotCropEditor({
  snapshot,
  area,
  isDisabled,
  onAreaChange,
}: IScreenshotCropEditorProps): JSX.Element {
  const id = useId();
  const drag = useRef<IScreenshotDrag | null>(null);
  const current = area ?? { x: 0, y: 0, width: snapshot.width, height: snapshot.height };
  const coordinates: IScreenshotCoordinate[] = [
    { key: "x", label: "Left", min: 0, max: snapshot.width - 1 },
    { key: "y", label: "Top", min: 0, max: snapshot.height - 1 },
    { key: "width", label: "Width", min: 1, max: snapshot.width - current.x },
    { key: "height", label: "Height", min: 1, max: snapshot.height - current.y },
  ];
  const move = (event: PointerEvent<SVGSVGElement>): void => {
    const gesture = drag.current;
    const point = readScreenshotPoint(event);
    if (!gesture || gesture.pointerId !== event.pointerId || point === null) return;
    onAreaChange(getScreenshotArea(gesture.start, point, snapshot));
  };
  const cancelDrag = (event: PointerEvent<SVGSVGElement>): void => {
    const gesture = drag.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    drag.current = null;
    onAreaChange(gesture.previous);
  };
  return (
    <div data-testid="ScreenshotCropEditor" className="flex min-h-0 flex-1 flex-col gap-2">
      <svg
        role="img"
        aria-label="Screenshot preview. Drag to select an area."
        viewBox={`0 0 ${snapshot.width} ${snapshot.height}`}
        className="min-h-0 w-full flex-1 touch-none select-none rounded-sm border border-border bg-secondary cursor-crosshair"
        onPointerDown={(event) => {
          const point = readScreenshotPoint(event);
          if (isDisabled || event.button !== 0 || drag.current || point === null) return;
          event.preventDefault();
          drag.current = { start: point, pointerId: event.pointerId, previous: area };
          event.currentTarget.setPointerCapture(event.pointerId);
          onAreaChange(null);
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          move(event);
          drag.current = null;
        }}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
      >
        <image href={snapshot.dataUrl} width={snapshot.width} height={snapshot.height} />
        {area ? (
          <>
            <defs>
              <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={snapshot.width} height={snapshot.height}>
                <rect width={snapshot.width} height={snapshot.height} fill="white" />
                <rect {...area} fill="black" />
              </mask>
            </defs>
            <rect width={snapshot.width} height={snapshot.height} mask={`url(#${id})`} className="fill-backdrop" />
            <rect {...area} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="2" className="stroke-primary" />
          </>
        ) : null}
      </svg>
      <fieldset className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4" disabled={isDisabled}>
        <legend className="sr-only">Selected area in screenshot pixels</legend>
        {coordinates.map(({ key, label, min, max }) => (
          <NumberField.Root
            key={key}
            id={`${id}-${key}`}
            render={<div className="flex min-w-0 flex-col gap-1 text-xs" />}
            min={min}
            max={max}
            step={1}
            value={current[key]}
            disabled={isDisabled}
            onValueChange={(value) => {
              if (value === null || !Number.isFinite(value)) return;
              const next = { ...current, [key]: Math.max(min, Math.min(max, Math.round(value))) };
              onAreaChange(getScreenshotArea(next, { x: next.x + next.width, y: next.y + next.height }, snapshot));
            }}
          >
            <label htmlFor={`${id}-${key}`}>{label}</label>
            <NumberField.Input render={<Input />} />
          </NumberField.Root>
        ))}
      </fieldset>
    </div>
  );
}

function readScreenshotPoint(event: PointerEvent<SVGSVGElement>): IAnnotationPoint | null {
  const matrix = event.currentTarget.getScreenCTM();
  if (matrix === null) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}
