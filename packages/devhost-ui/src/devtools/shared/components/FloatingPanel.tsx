import { forwardRef, type JSX, type ReactNode } from "react";

import { cn } from "../../../lib/utils";
import { Card } from "../../../components/ui/Card";

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
        position === "absolute" ? "absolute" : "fixed",
        level === "panel"
          ? "z-[var(--devhost-z-floating-panel)]"
          : level === "raised"
            ? "z-[var(--devhost-z-floating-raised)]"
            : "z-[var(--devhost-z-floating)]",
        "shadow-sm",
      )}
      data-testid="FloatingPanel"
    >
      <Card>{children}</Card>
    </div>
  );
});
