import { forwardRef, type JSX, type ReactNode } from "react";

import { cn } from "../../../lib/utils";

type FloatingPanelLevel = "floating" | "panel" | "raised";
type FloatingPanelPosition = "absolute" | "fixed";

interface IFloatingPanelProps {
  children: ReactNode;
  level?: FloatingPanelLevel;
  position?: FloatingPanelPosition;
}

export const FloatingPanel = forwardRef<HTMLDivElement, IFloatingPanelProps>(function FloatingPanel(
  { children, level = "floating", position = "fixed" }: IFloatingPanelProps,
  reference,
): JSX.Element {
  return (
    <div
      ref={reference}
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden rounded-md bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md",
        position === "absolute" ? "absolute" : "fixed",
        level === "panel"
          ? "z-[var(--devhost-z-floating-panel)]"
          : level === "raised"
            ? "z-[var(--devhost-z-floating-raised)]"
            : "z-[var(--devhost-z-floating)]",
        "shadow-sm",
      )}
      data-slot="card"
      data-testid="FloatingPanel"
    >
      {children}
    </div>
  );
});
