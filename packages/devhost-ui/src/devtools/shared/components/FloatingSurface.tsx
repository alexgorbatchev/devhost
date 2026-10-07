import type { ComponentProps, JSX, ReactNode } from "react";

import { cn } from "../../../lib/utils";

type FloatingSurfaceWidth = "md" | "sm";
type FloatingSurfaceSectionProps = Omit<ComponentProps<"section">, "className" | "hidden" | "inert" | "style">;

interface IFloatingSurfaceProps extends FloatingSurfaceSectionProps {
  children: ReactNode;
  isOpen: boolean;
  left: number;
  top: number;
  width: FloatingSurfaceWidth;
}

const floatingSurfaceWidthClassNames: Record<FloatingSurfaceWidth, string> = {
  md: "w-100",
  sm: "w-80",
};

/**
 * A surface placed at viewport coordinates in the popover layer of the devtools root. It stays mounted while
 * closed, hidden from the pointer and from assistive technology, so its content can fade out.
 */
export function FloatingSurface({ children, isOpen, left, top, width, ...props }: IFloatingSurfaceProps): JSX.Element {
  return (
    <section
      data-testid="FloatingSurface"
      {...props}
      className={cn(
        "devhost-fade pointer-events-auto fixed z-(--devhost-z-popover) max-w-[calc(100vw-20px)]",
        floatingSurfaceWidthClassNames[width],
      )}
      hidden={!isOpen}
      inert={!isOpen}
      style={{ left, top }}
    >
      {children}
    </section>
  );
}
