import { useEffect, useState, type JSX } from "react";

import { Kbd } from "../../../../components/ui/Kbd";

interface IAnnotationSelectionHintProps {
  isVisible: boolean;
  text?: string;
}

/** Pointer-following instructions for element selection and drawing, outside the chat layout. */
export function AnnotationSelectionHint({
  isVisible,
  text = "click to mark elements",
}: IAnnotationSelectionHintProps): JSX.Element {
  const [point, setPoint] = useState({ x: 12, y: 80 });
  useEffect(() => {
    if (!isVisible) return;
    const move = (event: PointerEvent): void =>
      setPoint({
        x: Math.max(8, Math.min(event.clientX + 12, window.innerWidth - 300)),
        y: Math.min(event.clientY + 20, window.innerHeight - 64),
      });
    document.addEventListener("pointermove", move, true);
    return () => document.removeEventListener("pointermove", move, true);
  }, [isVisible]);
  return (
    <div
      aria-label="Annotation selection"
      className="devhost-fade pointer-events-none fixed z-(--devhost-z-popover) flex max-w-[calc(100vw-16px)] items-center gap-2 rounded-md border border-edge bg-card px-2 py-1 text-card-foreground shadow-frame"
      style={{ left: point.x, top: point.y }}
      data-devhost-capture-exclude=""
      data-testid="AnnotationSelectionHint"
      hidden={!isVisible}
      role="status"
    >
      <strong>Annotate</strong>
      <span>{text}</span>
      <Kbd>Esc</Kbd>
    </div>
  );
}
