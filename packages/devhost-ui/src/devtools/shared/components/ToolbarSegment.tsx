import type { JSX, ReactNode, Ref } from "react";

import { cn } from "../../../lib/utils";

type ToolbarSegmentLayout = "fixed" | "shrink";

interface IToolbarSegmentProps {
  ariaLabel: string;
  children: ReactNode;
  layout?: ToolbarSegmentLayout;
  ref?: Ref<HTMLDivElement>;
  testId?: string;
}

/**
 * A grouped section of the devtools toolbar. `shrink` lets the segment give up width (with its overflow clipped)
 * so it can measure when its content no longer fits; the toolbar itself never overflows the viewport.
 */
export function ToolbarSegment({
  ariaLabel,
  children,
  layout = "fixed",
  ref,
  testId,
}: IToolbarSegmentProps): JSX.Element {
  return (
    <div
      ref={ref}
      aria-label={ariaLabel}
      className={cn(
        "flex items-center gap-1 border-l border-border px-1",
        layout === "shrink" ? "min-w-0 shrink overflow-hidden" : "shrink-0",
      )}
      data-devhost-instance-testid={testId}
      data-testid="ToolbarSegment"
      role="group"
    >
      {children}
    </div>
  );
}
