import { forwardRef, type ComponentProps, type JSX, type ReactNode } from "react";

import { Card } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";

type FloatingPanelLevel = "floating" | "panel" | "raised";
type FloatingPanelPosition = "absolute" | "fixed";

interface IFloatingPanelProps {
  children: ReactNode;
  className?: string;
  level?: FloatingPanelLevel;
  position?: FloatingPanelPosition;
  testId?: string;
}

type FloatingPanelProps = IFloatingPanelProps & Omit<ComponentProps<"div">, "children">;

export const FloatingPanel = forwardRef<HTMLDivElement, FloatingPanelProps>(function FloatingPanel(
  { children, className, level = "floating", position = "fixed", testId, ...props }: FloatingPanelProps,
  reference,
): JSX.Element {
  return (
    <Card
      ref={reference}
      className={cn(
        position === "absolute" ? "absolute" : "fixed",
        level === "panel"
          ? "z-[var(--devhost-z-floating-panel)]"
          : level === "raised"
            ? "z-[var(--devhost-z-floating-raised)]"
            : "z-[var(--devhost-z-floating)]",
        "shadow-lg",
        className,
      )}
      data-testid={testId}
      {...props}
    >
      {children}
    </Card>
  );
});
