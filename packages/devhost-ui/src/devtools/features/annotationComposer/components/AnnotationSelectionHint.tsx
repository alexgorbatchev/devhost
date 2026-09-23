import type { JSX } from "react";

import { Kbd } from "../../../../components/ui/Kbd";

interface IAnnotationSelectionHintProps {
  isVisible: boolean;
}

/**
 * Status bar shown while Alt-selection is active and nothing is marked yet, so the mode change is visible even
 * before the pointer reaches a selectable element.
 */
export function AnnotationSelectionHint({ isVisible }: IAnnotationSelectionHintProps): JSX.Element {
  return (
    <div
      aria-label="Annotation selection"
      className="devhost-fade pointer-events-none fixed top-2 left-1/2 z-(--devhost-z-popover) flex h-6.5 -translate-x-1/2 items-center gap-2 rounded-md border border-edge bg-card px-2 text-card-foreground shadow-frame"
      data-testid="AnnotationSelectionHint"
      hidden={!isVisible}
      role="status"
    >
      <strong>Annotate</strong>
      <span className="text-muted-foreground">click to mark elements</span>
      <Kbd>Esc</Kbd>
    </div>
  );
}
