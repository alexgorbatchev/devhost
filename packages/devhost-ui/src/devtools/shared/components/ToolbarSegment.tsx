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
 * A grouped section of the devtools toolbar. Fixed groups wrap their controls when wider than the viewport.
 * `shrink` fills the remaining row width and clips content for owners that measure overflow.
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
        "flex min-h-6 max-w-full items-center gap-1 border-l border-border px-1",
        layout === "shrink" ? "min-w-12 flex-1 overflow-hidden" : "shrink-0 flex-wrap",
      )}
      data-devhost-instance-testid={testId}
      data-testid="ToolbarSegment"
      role="group"
    >
      {children}
    </div>
  );
}
